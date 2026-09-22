import type { JsonValue } from "@kalada/core";
import type { KaladaCstNode } from "./cst-types.js";
import { diagnostic } from "./diagnostics.js";
import {
  DispatchFailure,
  type DispatchResult,
  dispatchBinary,
  dispatchConditional,
  dispatchField,
  dispatchUnary,
} from "./dispatch.js";
import type { KaladaParseResult, KaladaSyntaxDiagnostic } from "./public-types.js";
import type { LowerConfiguration } from "./reference-environment.js";
import { literalType, type StaticType } from "./static-types.js";

export interface SemanticInference {
  readonly type: StaticType;
  readonly complete: boolean;
  readonly dispatch?: DispatchResult;
  readonly failure?: DispatchFailure;
}

export interface SemanticAnalysis {
  readonly ordered: readonly KaladaCstNode[];
  readonly inferred: ReadonlyMap<KaladaCstNode, SemanticInference>;
  readonly diagnostics: readonly KaladaSyntaxDiagnostic[];
  readonly incomplete: boolean;
}

interface AnalysisState<R extends JsonValue> {
  readonly configuration: LowerConfiguration<R>;
  readonly inferred: Map<KaladaCstNode, SemanticInference>;
  readonly diagnostics: KaladaSyntaxDiagnostic[];
  incomplete: boolean;
}

export function analyzeSemantics<R extends JsonValue>(
  parsed: KaladaParseResult,
  configuration: LowerConfiguration<R>,
): SemanticAnalysis {
  const state: AnalysisState<R> = {
    configuration,
    inferred: new Map(),
    diagnostics: [...parsed.diagnostics],
    incomplete: parsed.diagnostics.length > 0,
  };
  const ordered = postorder(parsed.document.expression);
  for (const node of ordered) state.inferred.set(node, inferNode(node, state));
  return {
    ordered,
    inferred: state.inferred,
    diagnostics: state.diagnostics,
    incomplete: state.incomplete,
  };
}

function inferNode<R extends JsonValue>(
  node: KaladaCstNode,
  state: AnalysisState<R>,
): SemanticInference {
  if (node.kind === "literal") return complete(literalType(node.value));
  if (node.kind === "reference") return inferReference(node, state);
  if (node.kind === "error") return incomplete(state);
  try {
    return inferComposite(node, state);
  } catch (error) {
    return failed(node, error, state);
  }
}

function inferComposite<R extends JsonValue>(
  node: Exclude<KaladaCstNode, { kind: "literal" | "reference" | "error" }>,
  state: AnalysisState<R>,
): SemanticInference {
  if (node.kind === "group") {
    const child = childInference(node.expression, state);
    return node.closeToken === null || !child.complete ? incomplete(state) : child;
  }
  if (node.kind === "field-access") return inferField(node, state);
  if (node.kind === "unary") return inferUnary(node, state);
  if (node.kind === "binary") return inferBinary(node, state);
  return inferConditional(node, state);
}

function inferField<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "field-access" }>,
  state: AnalysisState<R>,
): SemanticInference {
  const target = childInference(node.target, state);
  if (!target.complete || node.field === null || node.fieldToken === null) return incomplete(state);
  return complete(dispatchField(target.type, node.optional));
}

function inferUnary<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "unary" }>,
  state: AnalysisState<R>,
): SemanticInference {
  const operand = childInference(node.operand, state);
  if (!operand.complete) return incomplete(state);
  const dispatch = dispatchUnary(node.operator, operand.type);
  return complete(dispatch.type, dispatch);
}

function inferBinary<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "binary" }>,
  state: AnalysisState<R>,
): SemanticInference {
  const left = childInference(node.left, state);
  const right = childInference(node.right, state);
  if (!left.complete || !right.complete) return incomplete(state);
  const dispatch = dispatchBinary(node.operator, left.type, right.type);
  return complete(dispatch.type, dispatch);
}

function inferConditional<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "conditional" }>,
  state: AnalysisState<R>,
): SemanticInference {
  const condition = childInference(node.condition, state);
  const then = childInference(node.then, state);
  const otherwise = childInference(node.else, state);
  if (node.colonToken === null || !condition.complete || !then.complete || !otherwise.complete) {
    return incomplete(state);
  }
  return complete(dispatchConditional(condition.type, then.type, otherwise.type));
}

function inferReference<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "reference" }>,
  state: AnalysisState<R>,
): SemanticInference {
  const environment = state.configuration.environment;
  const binding = environment?.get(node.name);
  if (!environment || binding) return complete(binding?.type ?? "dynamic");
  state.incomplete = true;
  state.diagnostics.push(
    diagnostic(
      "lower",
      "KALADA_SYNTAX_UNKNOWN_REFERENCE",
      "Kalada reference is not present in the lowering environment.",
      node.range,
      [],
    ),
  );
  return { type: "dynamic", complete: false };
}

function failed<R extends JsonValue>(
  node: KaladaCstNode,
  error: unknown,
  state: AnalysisState<R>,
): SemanticInference {
  state.incomplete = true;
  const failure = error instanceof DispatchFailure ? error : undefined;
  state.diagnostics.push(
    diagnostic(
      "lower",
      failure?.code ?? "KALADA_SYNTAX_INVALID_INPUT",
      "Kalada semantic analysis could not determine this expression.",
      node.range,
      [],
    ),
  );
  return { type: "dynamic", complete: false, ...(failure ? { failure } : {}) };
}

function childInference<R extends JsonValue>(
  node: KaladaCstNode,
  state: AnalysisState<R>,
): SemanticInference {
  return state.inferred.get(node) ?? incomplete(state);
}

function complete(type: StaticType, dispatch?: DispatchResult): SemanticInference {
  return { type, complete: true, ...(dispatch ? { dispatch } : {}) };
}

function incomplete<R extends JsonValue>(state: AnalysisState<R>): SemanticInference {
  state.incomplete = true;
  return { type: "dynamic", complete: false };
}

function postorder(root: KaladaCstNode): KaladaCstNode[] {
  const output: KaladaCstNode[] = [];
  const stack: { node: KaladaCstNode; visited: boolean }[] = [{ node: root, visited: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (entry.visited) output.push(entry.node);
    else scheduleChildren(stack, entry.node);
  }
  return output;
}

function scheduleChildren(
  stack: { node: KaladaCstNode; visited: boolean }[],
  node: KaladaCstNode,
): void {
  stack.push({ node, visited: true });
  const children = nodeChildren(node);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child) stack.push({ node: child, visited: false });
  }
}

function nodeChildren(node: KaladaCstNode): readonly KaladaCstNode[] {
  if (node.kind === "group") return [node.expression];
  if (node.kind === "field-access") return [node.target];
  if (node.kind === "unary") return [node.operand];
  if (node.kind === "binary") return [node.left, node.right];
  if (node.kind === "conditional") return [node.condition, node.then, node.else];
  return [];
}

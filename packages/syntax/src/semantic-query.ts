import type { JsonValue } from "@kalada/core";
import type { KaladaBinaryOperator, KaladaCstNode, KaladaSourceRange } from "./cst-types.js";
import { diagnostic } from "./diagnostics.js";
import {
  DispatchFailure,
  dispatchBinary,
  dispatchConditional,
  dispatchField,
  dispatchUnary,
} from "./dispatch.js";
import { deepFreeze } from "./freeze.js";
import { syntaxLimitsFor } from "./parse.js";
import type {
  KaladaLowerOptions,
  KaladaParseResult,
  KaladaSemanticNodeInfo,
  KaladaSemanticQueryResult,
  KaladaSemanticSupport,
  KaladaSyntaxDiagnostic,
} from "./public-types.js";
import { type LowerConfiguration, readLowerConfiguration } from "./reference-environment.js";
import { literalType, projectStaticType, type StaticType } from "./static-types.js";

const BINARY_OPERATORS: readonly KaladaBinaryOperator[] = Object.freeze([
  "*",
  "/",
  "%",
  "+",
  "-",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "==",
  "!=",
  "&&",
  "xor",
  "||",
  "??",
]);

interface Inference {
  readonly type: StaticType;
  readonly complete: boolean;
}

interface QueryState<R extends JsonValue> {
  readonly configuration: LowerConfiguration<R>;
  readonly inferred: Map<KaladaCstNode, Inference>;
  readonly diagnostics: KaladaSyntaxDiagnostic[];
  incomplete: boolean;
}

export function queryKaladaV1Semantics<R extends JsonValue = string>(
  parsed: KaladaParseResult,
  options?: KaladaLowerOptions<R>,
): KaladaSemanticQueryResult {
  const limits = syntaxLimitsFor(parsed);
  if (limits === null) return invalidQuery();
  const configuration = safeConfiguration(options, limits);
  if (configuration === null) return invalidQuery(parsed.document.expression.range);
  const state: QueryState<R> = {
    configuration,
    inferred: new Map(),
    diagnostics: [...parsed.diagnostics],
    incomplete: parsed.diagnostics.length > 0,
  };
  const ordered = postorder(parsed.document.expression);
  for (const node of ordered) state.inferred.set(node, inferNode(node, state));
  const nodes = ordered.map((node) => describeNode(node, state.inferred));
  return deepFreeze({ nodes, diagnostics: state.diagnostics, incomplete: state.incomplete });
}

function safeConfiguration<R extends JsonValue>(
  options: KaladaLowerOptions<R> | undefined,
  limits: NonNullable<ReturnType<typeof syntaxLimitsFor>>,
): LowerConfiguration<R> | null {
  try {
    return readLowerConfiguration(options, limits);
  } catch {
    return null;
  }
}

function postorder(root: KaladaCstNode): KaladaCstNode[] {
  const output: KaladaCstNode[] = [];
  const stack: { node: KaladaCstNode; visited: boolean }[] = [{ node: root, visited: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (entry.visited) output.push(entry.node);
    else {
      stack.push({ node: entry.node, visited: true });
      const children = nodeChildren(entry.node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) stack.push({ node: child, visited: false });
      }
    }
  }
  return output;
}

function nodeChildren(node: KaladaCstNode): readonly KaladaCstNode[] {
  if (node.kind === "group") return [node.expression];
  if (node.kind === "field-access") return [node.target];
  if (node.kind === "unary") return [node.operand];
  if (node.kind === "binary") return [node.left, node.right];
  if (node.kind === "conditional") return [node.condition, node.then, node.else];
  return [];
}

function inferNode<R extends JsonValue>(node: KaladaCstNode, state: QueryState<R>): Inference {
  if (node.kind === "literal") return complete(literalType(node.value));
  if (node.kind === "reference") return inferReference(node, state);
  if (node.kind === "error") return incomplete(state);
  try {
    return inferComposite(node, state);
  } catch (error) {
    state.incomplete = true;
    state.diagnostics.push(dispatchDiagnostic(error, node));
    return { type: "dynamic", complete: false };
  }
}

function inferComposite<R extends JsonValue>(
  node: Exclude<KaladaCstNode, { kind: "literal" | "reference" | "error" }>,
  state: QueryState<R>,
): Inference {
  if (node.kind === "group") {
    const child = childInference(node.expression, state);
    return node.closeToken === null || !child.complete ? incomplete(state) : child;
  }
  if (node.kind === "field-access")
    return inferField(node, childInference(node.target, state), state);
  if (node.kind === "unary") {
    const operand = childInference(node.operand, state);
    return operand.complete
      ? complete(dispatchUnary(node.operator, operand.type).type)
      : incomplete(state);
  }
  if (node.kind === "binary") return inferBinary(node, state);
  return inferConditional(node, state);
}

function inferBinary<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "binary" }>,
  state: QueryState<R>,
): Inference {
  const left = childInference(node.left, state);
  const right = childInference(node.right, state);
  if (!left.complete || !right.complete) return incomplete(state);
  return complete(dispatchBinary(node.operator, left.type, right.type).type);
}

function inferConditional<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "conditional" }>,
  state: QueryState<R>,
): Inference {
  const condition = childInference(node.condition, state);
  const then = childInference(node.then, state);
  const otherwise = childInference(node.else, state);
  if (node.colonToken === null || !condition.complete || !then.complete || !otherwise.complete) {
    return incomplete(state);
  }
  return complete(dispatchConditional(condition.type, then.type, otherwise.type));
}

function childInference<R extends JsonValue>(node: KaladaCstNode, state: QueryState<R>): Inference {
  return state.inferred.get(node) ?? incomplete(state);
}

function inferReference<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "reference" }>,
  state: QueryState<R>,
): Inference {
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

function inferField<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "field-access" }>,
  target: Inference,
  state: QueryState<R>,
): Inference {
  if (!target.complete || node.field === null || node.fieldToken === null) return incomplete(state);
  return complete(dispatchField(target.type, node.optional));
}

function complete(type: StaticType): Inference {
  return { type, complete: true };
}

function incomplete<R extends JsonValue>(state: QueryState<R>): Inference {
  state.incomplete = true;
  return { type: "dynamic", complete: false };
}

function describeNode(
  node: KaladaCstNode,
  inferred: ReadonlyMap<KaladaCstNode, Inference>,
): KaladaSemanticNodeInfo {
  const result = inferred.get(node) ?? { type: "dynamic" as const, complete: false };
  const type = projectStaticType(result.type);
  return {
    range: node.range,
    type,
    known: result.complete && type !== "dynamic",
    fieldAccess: {
      plain: fieldSupport(result, false),
      optional: fieldSupport(result, true),
    },
    operators: BINARY_OPERATORS.map((operator) => ({
      operator,
      support: operatorSupport(operator, node, result, inferred),
    })),
  };
}

function fieldSupport(inference: Inference, optional: boolean): KaladaSemanticSupport {
  if (!inference.complete || inference.type === "dynamic") return "conditional";
  try {
    dispatchField(inference.type, optional);
    return "supported";
  } catch {
    return "unsupported";
  }
}

function operatorSupport(
  operator: KaladaBinaryOperator,
  node: KaladaCstNode,
  left: Inference,
  inferred: ReadonlyMap<KaladaCstNode, Inference>,
): KaladaSemanticSupport {
  if (!left.complete) return "conditional";
  if (node.kind === "binary" && node.operator === operator) {
    const actualLeft = inferred.get(node.left);
    const actualRight = inferred.get(node.right);
    if (actualLeft?.complete && actualRight?.complete) {
      return dispatchSupport(operator, actualLeft.type, actualRight.type, true);
    }
  }
  return dispatchSupport(operator, left.type, "dynamic", false);
}

function dispatchSupport(
  operator: KaladaBinaryOperator,
  left: StaticType,
  right: StaticType,
  completeOperands: boolean,
): KaladaSemanticSupport {
  try {
    dispatchBinary(operator, left, right);
    if (!completeOperands || containsDynamic(left) || containsDynamic(right)) return "conditional";
    return "supported";
  } catch {
    return left === "dynamic" ? "conditional" : "unsupported";
  }
}

function containsDynamic(type: StaticType): boolean {
  return type === "dynamic" || ("shape" in type && containsDynamic(type.value));
}

function dispatchDiagnostic(error: unknown, node: KaladaCstNode): KaladaSyntaxDiagnostic {
  const code = error instanceof DispatchFailure ? error.code : "KALADA_SYNTAX_INVALID_INPUT";
  return diagnostic(
    "lower",
    code,
    "Kalada semantic query could not determine this expression.",
    node.range,
    [],
  );
}

function invalidQuery(
  range: KaladaSourceRange = Object.freeze({ start: 0, end: 0 }),
): KaladaSemanticQueryResult {
  const problem = diagnostic(
    "lower",
    "KALADA_SYNTAX_INVALID_INPUT",
    "Kalada syntax input is invalid.",
    range,
    [],
  );
  return deepFreeze({ nodes: [], diagnostics: [problem], incomplete: true });
}

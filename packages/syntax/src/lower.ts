import {
  compileKaladaV1Program,
  type JsonValue,
  KaladaV1,
  type KaladaV1Diagnostic,
  type KaladaV1Expression,
} from "@kalada/core";
import type { KaladaBinaryCstNode, KaladaCstNode, KaladaSourceRange } from "./cst-types.js";
import { diagnostic } from "./diagnostics.js";
import { DispatchFailure, type DispatchResult } from "./dispatch.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import { syntaxLimitsFor } from "./parse.js";
import type {
  KaladaLowerOptions,
  KaladaLowerOutcome,
  KaladaParseResult,
  KaladaSourceMapEntry,
  KaladaSyntaxDiagnostic,
} from "./public-types.js";
import { type LowerConfiguration, readLowerConfiguration } from "./reference-environment.js";
import { analyzeSemantics, type SemanticInference } from "./semantic-inference.js";
import { addMap, finishMap, rangeForPath, widenNode } from "./source-map.js";
import { projectStaticType, type StaticType } from "./static-types.js";

interface Lowered<R extends JsonValue> {
  readonly expression: KaladaV1Expression<R>;
  readonly type: StaticType;
}

interface LowerState<R extends JsonValue> {
  readonly parsed: KaladaParseResult;
  readonly configuration: LowerConfiguration<R>;
  readonly entries: KaladaSourceMapEntry[];
  readonly inferred: ReadonlyMap<KaladaCstNode, SemanticInference>;
}

const CORE_MESSAGES = Object.freeze({
  KALADA_OPERATOR_TYPE: "Kalada operator received an incompatible value.",
  KALADA_OPERATOR_AMBIGUOUS: "Kalada operator domain is ambiguous.",
  KALADA_OPTION_REQUIRED: "Kalada option coalesce requires an Option value.",
  KALADA_FIELD_TYPE_MISMATCH: "Kalada field access requires a JSON object.",
});

class LowerFailure extends Error {
  readonly diagnostic: KaladaSyntaxDiagnostic;

  constructor(diagnostic: KaladaSyntaxDiagnostic) {
    super(diagnostic.code);
    this.diagnostic = diagnostic;
  }
}

export function lowerKaladaV1Expression<R extends JsonValue = string>(
  parsed: KaladaParseResult,
  options?: KaladaLowerOptions<R>,
): KaladaLowerOutcome<R> {
  const limits = syntaxLimitsFor(parsed);
  if (limits === null) return invalidOutcome();
  if (parsed.diagnostics.length > 0)
    return deepFreeze({ ok: false, diagnostics: parsed.diagnostics });
  let configuration: LowerConfiguration<R> | null;
  try {
    configuration = readLowerConfiguration(options, limits);
  } catch {
    configuration = null;
  }
  if (configuration === null) return invalidOutcome(parsed.document.expression.range);
  const analysis = analyzeSemantics(parsed, configuration);
  const state: LowerState<R> = { parsed, configuration, entries: [], inferred: analysis.inferred };
  try {
    const lowered = lowerNode(parsed.document.expression, ["expression"], state);
    const input = KaladaV1.program(lowered.expression);
    const compiled = compileKaladaV1Program(input, configuration.coreOptions);
    if (!compiled.ok) throw coreFailure(compiled.diagnostic, state);
    return deepFreeze({
      ok: true,
      program: compiled.value.program,
      sourceMap: finishMap(state.entries),
      resultType: projectStaticType(lowered.type),
    });
  } catch (error) {
    const problem =
      error instanceof LowerFailure
        ? error.diagnostic
        : invalidDiagnostic(parsed.document.expression.range);
    return deepFreeze({ ok: false, diagnostics: [problem] });
  }
}

function lowerNode<R extends JsonValue>(
  node: KaladaCstNode,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  if (node.kind === "literal") return lowerLiteral(node, path, state);
  if (node.kind === "reference") return lowerReference(node, path, state);
  if (node.kind === "group") return lowerGroup(node, path, state);
  if (node.kind === "field-access") return lowerField(node, path, state);
  if (node.kind === "unary") return lowerUnary(node, path, state);
  if (node.kind === "binary") return lowerBinary(node, path, state);
  if (node.kind === "conditional") return lowerConditional(node, path, state);
  throw new LowerFailure(invalidDiagnostic(node.range));
}

function lowerLiteral<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "literal" }>,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  addMap(state.entries, path, "node", node.range);
  addMap(state.entries, [...path, "value"], "literal", node.range);
  return { expression: KaladaV1.literal<R>(node.value), type: inferenceFor(node, state).type };
}

function lowerReference<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "reference" }>,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  const binding = state.configuration.environment?.get(node.name);
  if (state.configuration.environment && !binding) {
    throw syntaxFailure("KALADA_SYNTAX_UNKNOWN_REFERENCE", node.range, [...path, "ref"]);
  }
  addMap(state.entries, path, "node", node.range);
  addMap(state.entries, [...path, "ref"], "reference", node.range);
  const type = inferenceFor(node, state).type;
  return binding
    ? { expression: KaladaV1.ref<R>(binding.reference), type }
    : { expression: KaladaV1.ref<R>(node.name as R), type };
}

function lowerGroup<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "group" }>,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  const child = lowerNode(node.expression, path, state);
  addMap(state.entries, path, "group", node.range);
  widenNode(state.entries, path, node.range);
  return child;
}

function lowerField<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "field-access" }>,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  const target = lowerNode(node.target, [...path, "target"], state);
  const operatorRange = sourceRange(state, node.operatorToken);
  addMap(state.entries, path, "operator", operatorRange);
  const fieldRange = node.fieldToken === null ? operatorRange : sourceRange(state, node.fieldToken);
  addMap(state.entries, [...path, "field"], "field", fieldRange);
  const inferred = inferenceFor(node, state);
  if (inferred.failure) throw dispatchFailure(inferred.failure, path, state, node.range);
  if (!inferred.complete) throw new LowerFailure(invalidDiagnostic(node.range));
  const expression = node.optional
    ? KaladaV1.optionalFieldAccess(target.expression, node.field as string)
    : KaladaV1.fieldAccess(target.expression, node.field as string);
  addMap(state.entries, path, "node", node.range);
  return { expression, type: inferred.type };
}

function lowerUnary<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "unary" }>,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  const operand = lowerNode(node.operand, [...path, "operand"], state);
  const operatorPath = node.operator === "!" ? path : [...path, "operator"];
  addMap(state.entries, operatorPath, "operator", sourceRange(state, node.operatorToken));
  const inferred = inferenceFor(node, state);
  if (inferred.failure) throw dispatchFailure(inferred.failure, path, state, node.range, "operand");
  const result = requireDispatch(inferred, node.range);
  const expression =
    node.operator === "!"
      ? KaladaV1.booleanNot(operand.expression)
      : KaladaV1.numericUnary(node.operator === "+" ? "plus" : "negate", operand.expression);
  addMap(state.entries, path, "node", node.range);
  return { expression, type: result.type };
}

function lowerBinary<R extends JsonValue>(
  node: KaladaBinaryCstNode,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  const [leftKey, rightKey] = binaryKeys(node.operator);
  const left = lowerNode(node.left, [...path, leftKey], state);
  const right = lowerNode(node.right, [...path, rightKey], state);
  const operatorPath = operatorHasField(node.operator) ? [...path, "operator"] : path;
  addMap(state.entries, operatorPath, "operator", sourceRange(state, node.operatorToken));
  const inferred = inferenceFor(node, state);
  if (inferred.failure) throw dispatchFailure(inferred.failure, path, state, node.range);
  const dispatch = requireDispatch(inferred, node.range);
  const expression = binaryExpression(
    node.operator,
    dispatch.family,
    left.expression,
    right.expression,
  );
  addMap(state.entries, path, "node", node.range);
  return { expression, type: dispatch.type };
}

function lowerConditional<R extends JsonValue>(
  node: Extract<KaladaCstNode, { kind: "conditional" }>,
  path: readonly (string | number)[],
  state: LowerState<R>,
): Lowered<R> {
  const condition = lowerNode(node.condition, [...path, "condition"], state);
  const then = lowerNode(node.then, [...path, "then"], state);
  const otherwise = lowerNode(node.else, [...path, "else"], state);
  addMap(state.entries, path, "operator", sourceRange(state, node.questionToken));
  if (node.colonToken !== null)
    addMap(state.entries, path, "operator", sourceRange(state, node.colonToken));
  const inferred = inferenceFor(node, state);
  if (inferred.failure) throw dispatchFailure(inferred.failure, path, state, node.range);
  if (!inferred.complete) throw new LowerFailure(invalidDiagnostic(node.range));
  addMap(state.entries, path, "node", node.range);
  return {
    expression: KaladaV1.conditional(condition.expression, then.expression, otherwise.expression),
    type: inferred.type,
  };
}

function binaryExpression<R extends JsonValue>(
  operator: KaladaBinaryCstNode["operator"],
  family: DispatchResult["family"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> {
  if (family === "equality")
    return KaladaV1.equality(operator === "==" ? "equal" : "not-equal", left, right);
  if (family === "ordered-number" || family === "ordered-string")
    return KaladaV1.orderedComparison(
      family === "ordered-number" ? "number" : "string",
      comparisonOperator(operator),
      left,
      right,
    );
  if (family === "temporal-comparison")
    return KaladaV1.temporalComparison(comparisonOperator(operator), left, right);
  return remainingBinaryExpression(operator, family, left, right);
}

function remainingBinaryExpression<R extends JsonValue>(
  operator: KaladaBinaryCstNode["operator"],
  family: DispatchResult["family"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> {
  if (family === "membership") return KaladaV1.membership(left, right);
  if (family === "numeric-binary")
    return KaladaV1.numericBinary(numericOperator(operator), left, right);
  if (family === "temporal-arithmetic")
    return KaladaV1.temporalArithmetic(operator === "+" ? "add" : "subtract", left, right);
  if (family === "boolean-logical")
    return KaladaV1.booleanLogical(operator === "&&" ? "and" : "or", left, right);
  if (family === "boolean-xor") return KaladaV1.booleanXor(left, right);
  return KaladaV1.optionCoalesce(left, right);
}

function comparisonOperator(
  operator: KaladaBinaryCstNode["operator"],
): "less-than" | "less-than-or-equal" | "greater-than" | "greater-than-or-equal" {
  const values = {
    "<": "less-than",
    "<=": "less-than-or-equal",
    ">": "greater-than",
    ">=": "greater-than-or-equal",
  } as const;
  return values[operator as keyof typeof values];
}

function numericOperator(
  operator: KaladaBinaryCstNode["operator"],
): "add" | "subtract" | "multiply" | "divide" | "remainder" {
  const values = {
    "+": "add",
    "-": "subtract",
    "*": "multiply",
    "/": "divide",
    "%": "remainder",
  } as const;
  return values[operator as keyof typeof values];
}

function binaryKeys(operator: KaladaBinaryCstNode["operator"]): readonly [string, string] {
  if (operator === "in") return ["needle", "array"];
  if (operator === "??") return ["option", "fallback"];
  return ["left", "right"];
}

function operatorHasField(operator: KaladaBinaryCstNode["operator"]): boolean {
  return !["in", "xor", "??"].includes(operator);
}

function dispatchFailure<R extends JsonValue>(
  error: unknown,
  path: readonly (string | number)[],
  state: LowerState<R>,
  fallback: KaladaSourceRange,
  unaryOperand?: "operand",
): LowerFailure {
  if (!(error instanceof DispatchFailure)) return new LowerFailure(invalidDiagnostic(fallback));
  const key = unaryOperand ?? error.operand;
  const diagnosticPath = key === "operator" ? [...path, "operator"] : [...path, key];
  const range = rangeForPath(state.entries, diagnosticPath, fallback);
  return new LowerFailure(
    diagnostic("lower", error.code, CORE_MESSAGES[error.code], range, diagnosticPath),
  );
}

function coreFailure<R extends JsonValue>(
  problem: KaladaV1Diagnostic,
  state: LowerState<R>,
): LowerFailure {
  const range = rangeForPath(state.entries, problem.path, state.parsed.document.expression.range);
  return new LowerFailure(diagnostic("lower", problem.code, problem.message, range, problem.path));
}

function syntaxFailure(
  code: "KALADA_SYNTAX_UNKNOWN_REFERENCE",
  range: KaladaSourceRange,
  path: readonly (string | number)[],
): LowerFailure {
  return new LowerFailure(
    diagnostic(
      "lower",
      code,
      "Kalada reference is not present in the lowering environment.",
      range,
      path,
    ),
  );
}

function invalidDiagnostic(range: KaladaSourceRange = freezeRange(0, 0)): KaladaSyntaxDiagnostic {
  return diagnostic(
    "lower",
    "KALADA_SYNTAX_INVALID_INPUT",
    "Kalada syntax input is invalid.",
    range,
    [],
  );
}

function invalidOutcome<R extends JsonValue>(range?: KaladaSourceRange): KaladaLowerOutcome<R> {
  return deepFreeze({ ok: false, diagnostics: [invalidDiagnostic(range)] });
}

function sourceRange<R extends JsonValue>(state: LowerState<R>, token: number): KaladaSourceRange {
  return state.parsed.document.tokens[token]?.range ?? state.parsed.document.expression.range;
}

function inferenceFor<R extends JsonValue>(
  node: KaladaCstNode,
  state: LowerState<R>,
): SemanticInference {
  return state.inferred.get(node) ?? { type: "dynamic", complete: false };
}

function requireDispatch(inferred: SemanticInference, range: KaladaSourceRange): DispatchResult {
  if (!inferred.complete || !inferred.dispatch) throw new LowerFailure(invalidDiagnostic(range));
  return inferred.dispatch;
}

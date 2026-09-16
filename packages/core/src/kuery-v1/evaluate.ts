import { rejectCallbackPromise } from "./callback-promise.js";
import { cloneJson } from "./inspect.js";
import { type ExpressionOperator, type ExpressionValueType, internalProfile } from "./profile.js";
import { ExpressionFailure, failure, success } from "./result.js";
import type {
  ExpressionLimits,
  ExpressionPath,
  JsonValue,
  ReferenceResolver,
  Result,
  ValueExpression,
} from "./types.js";

interface EvaluationState<R extends JsonValue> {
  readonly resolve: ReferenceResolver<R>;
  readonly operators: ReadonlyMap<ValueExpression<R>, ExpressionOperator>;
  readonly limits: ExpressionLimits;
  steps: number;
}

interface Outcome {
  readonly found: boolean;
  readonly value?: JsonValue;
  readonly denied?: boolean;
  readonly path?: ExpressionPath;
}

type ParsedResolution = { readonly valid: false } | Outcome;

export function evaluateCompiled<R extends JsonValue>(
  expression: ValueExpression<R>,
  resolve: ReferenceResolver<R>,
  operators: ReadonlyMap<ValueExpression<R>, ExpressionOperator>,
  limits: ExpressionLimits,
): Result<JsonValue> {
  const state: EvaluationState<R> = { resolve, operators, limits, steps: 0 };
  try {
    const outcome = evaluateNode(expression, [], state);
    if (!outcome.found) {
      return failure(
        outcome.denied ? "EXPRESSION_REFERENCE_DENIED" : "EXPRESSION_REFERENCE_MISSING",
        outcome.path ?? [],
      );
    }
    return success(outcome.value!);
  } catch (error) {
    const problem =
      error instanceof ExpressionFailure
        ? error
        : new ExpressionFailure("EXPRESSION_OPERATOR_ERROR", []);
    return failure(problem.code, problem.expressionPath);
  }
}

function evaluateNode<R extends JsonValue>(
  node: ValueExpression<R>,
  path: ExpressionPath,
  state: EvaluationState<R>,
): Outcome {
  state.steps += 1;
  if (state.steps > state.limits.maxEvaluationSteps) {
    throw new ExpressionFailure("EXPRESSION_EVALUATION_LIMIT", path);
  }
  if (node.kind === "literal") return { found: true, value: node.value };
  if (node.kind === "ref") return resolveReference(node.ref, path, state.resolve, state.limits);
  const operator = state.operators.get(node);
  if (!operator) throw new ExpressionFailure("EXPRESSION_UNKNOWN_OPERATOR", [...path, "op"]);
  return evaluateOperator(node, operator, path, state);
}

function resolveReference<R extends JsonValue>(
  reference: R,
  path: ExpressionPath,
  resolve: ReferenceResolver<R>,
  limits: ExpressionLimits,
): Outcome {
  try {
    const result: unknown = resolve(reference);
    if (rejectCallbackPromise(result))
      throw new ExpressionFailure("EXPRESSION_ASYNC_UNSUPPORTED", path);
    const parsed = parseResolution(result);
    if (!parsed.valid) throw new ExpressionFailure("EXPRESSION_REFERENCE_ERROR", path);
    if (!parsed.found) return { ...parsed, path };
    return { found: true, value: safeCallbackValue(parsed.value, path, limits) };
  } catch (error) {
    if (error instanceof ExpressionFailure) throw error;
    throw new ExpressionFailure("EXPRESSION_REFERENCE_ERROR", path);
  }
}

function parseResolution(input: unknown): ParsedResolution & { readonly valid: boolean } {
  if (typeof input !== "object" || input === null) return { valid: false };
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return { valid: false };
    const found = Object.getOwnPropertyDescriptor(input, "found");
    if (!found || !("value" in found) || !found.enumerable || typeof found.value !== "boolean")
      return { valid: false };
    const keys = Reflect.ownKeys(input);
    if (!found.value) return parseMissingResolution(input, keys);
    const value = Object.getOwnPropertyDescriptor(input, "value");
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === "found" || key === "value") ||
      !value ||
      !("value" in value) ||
      !value.enumerable
    ) {
      return { valid: false };
    }
    return { valid: true, found: true, value: value.value };
  } catch {
    return { valid: false };
  }
}

function parseMissingResolution(
  input: object,
  keys: readonly PropertyKey[],
): ParsedResolution & { readonly valid: boolean } {
  if (keys.length === 1 && keys[0] === "found") return { valid: true, found: false };
  if (keys.length !== 2 || !keys.includes("found") || !keys.includes("reason"))
    return { valid: false };
  const reason = Object.getOwnPropertyDescriptor(input, "reason");
  if (!reason || !("value" in reason) || !reason.enumerable) return { valid: false };
  if (reason.value === undefined || reason.value === "missing")
    return { valid: true, found: false };
  if (reason.value === "denied") return { valid: true, found: false, denied: true };
  return { valid: false };
}

function evaluateOperator<R extends JsonValue>(
  node: Extract<ValueExpression<R>, { kind: "op" }>,
  operator: ExpressionOperator,
  path: ExpressionPath,
  state: EvaluationState<R>,
): Outcome {
  const strategy = internalProfile.getEvaluationStrategy(operator);
  if (strategy === "exists") return evaluateExists(node.args[0]!, [...path, "args", 0], state);
  if (strategy === "and" || strategy === "or") return evaluateBoolean(node, strategy, path, state);
  if (strategy === "coalesce") return evaluateCoalesce(node, path, state);
  if (strategy === "if") return evaluateIf(node, path, state);
  const args: JsonValue[] = [];
  for (let index = 0; index < node.args.length; index += 1) {
    const argPath = [...path, "args", index];
    const outcome = evaluateNode(node.args[index]!, argPath, state);
    if (!outcome.found) return outcome;
    args.push(outcome.value!);
  }
  return { found: true, value: execute(operator, args, path, state.limits) };
}

function evaluateExists<R extends JsonValue>(
  argument: ValueExpression<R>,
  path: ExpressionPath,
  state: EvaluationState<R>,
): Outcome {
  const outcome = evaluateNode(argument, path, state);
  if (outcome.denied)
    throw new ExpressionFailure("EXPRESSION_REFERENCE_DENIED", outcome.path ?? path);
  return { found: true, value: outcome.found };
}

function evaluateBoolean<R extends JsonValue>(
  node: Extract<ValueExpression<R>, { kind: "op" }>,
  strategy: "and" | "or",
  path: ExpressionPath,
  state: EvaluationState<R>,
): Outcome {
  const expected = strategy === "and";
  for (let index = 0; index < node.args.length; index += 1) {
    const argPath = [...path, "args", index];
    const outcome = evaluateNode(node.args[index]!, argPath, state);
    if (!outcome.found) return outcome;
    const value = outcome.value!;
    assertType(value, "boolean", argPath);
    if (value !== expected) return { found: true, value: !expected };
  }
  return { found: true, value: expected };
}

function evaluateIf<R extends JsonValue>(
  node: Extract<ValueExpression<R>, { kind: "op" }>,
  path: ExpressionPath,
  state: EvaluationState<R>,
): Outcome {
  const conditionPath = [...path, "args", 0];
  const condition = evaluateNode(node.args[0]!, conditionPath, state);
  if (!condition.found) return condition;
  assertType(condition.value!, "boolean", conditionPath);
  const selected = condition.value ? 1 : 2;
  return evaluateNode(node.args[selected]!, [...path, "args", selected], state);
}

function evaluateCoalesce<R extends JsonValue>(
  node: Extract<ValueExpression<R>, { kind: "op" }>,
  path: ExpressionPath,
  state: EvaluationState<R>,
): Outcome {
  for (let index = 0; index < node.args.length; index += 1) {
    const argPath = [...path, "args", index];
    const outcome = evaluateNode(node.args[index]!, argPath, state);
    if (outcome.denied)
      throw new ExpressionFailure("EXPRESSION_REFERENCE_DENIED", outcome.path ?? argPath);
    if (outcome.found && outcome.value !== null) return outcome;
  }
  return { found: true, value: null };
}

function execute(
  operator: ExpressionOperator,
  args: readonly JsonValue[],
  path: ExpressionPath,
  limits: ExpressionLimits,
): JsonValue {
  validateInputTypes(operator, args, path);
  try {
    const result: unknown = operator.execute(Object.freeze([...args]));
    if (rejectCallbackPromise(result))
      throw new ExpressionFailure("EXPRESSION_ASYNC_UNSUPPORTED", path);
    const value = safeCallbackValue(result, path, limits);
    if (operator.resultType) assertType(value, operator.resultType, path);
    return value;
  } catch (error) {
    if (error instanceof ExpressionFailure) throw new ExpressionFailure(error.code, path);
    throw new ExpressionFailure("EXPRESSION_OPERATOR_ERROR", path);
  }
}

function validateInputTypes(
  operator: ExpressionOperator,
  args: readonly JsonValue[],
  path: ExpressionPath,
): void {
  if (!operator.inputTypes) return;
  args.forEach((value, index) => {
    const expected = operator.inputTypes![index] ?? operator.inputTypes![0];
    if (expected) assertType(value, expected, [...path, "args", index]);
  });
}

function assertType(value: JsonValue, expected: ExpressionValueType, path: ExpressionPath): void {
  if (expected === "any") return;
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (actual !== expected) throw new ExpressionFailure("EXPRESSION_TYPE_MISMATCH", path);
}

function safeCallbackValue(
  input: unknown,
  path: ExpressionPath,
  limits: ExpressionLimits,
): JsonValue {
  try {
    return cloneJson(input, path, 0, {
      maxDepth: limits.maxDepth,
      maxNodes: limits.maxNodes,
      maxStringLength: limits.maxStringLength,
      nodes: 0,
      active: new WeakSet(),
    });
  } catch (error) {
    if (error instanceof ExpressionFailure && error.code === "EXPRESSION_LIMIT_EXCEEDED")
      throw error;
    throw new ExpressionFailure("EXPRESSION_INVALID_RESULT", path);
  }
}

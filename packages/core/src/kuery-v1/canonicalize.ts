import {
  arrayLength,
  cloneJson,
  dataProperties,
  exceedsStringLimit,
  stableJson,
  type ValidationState,
} from "./inspect.js";
import { resolveLimits } from "./limits.js";
import { ExpressionFailure, failure, success } from "./result.js";
import type {
  CanonicalizeExpressionOptions,
  ExpressionLimits,
  ExpressionPath,
  JsonValue,
  Result,
  ValueExpression,
} from "./types.js";

const NODE_KEYS = Object.freeze({
  literal: new Set(["kind", "value"]),
  ref: new Set(["kind", "ref"]),
  op: new Set(["kind", "op", "args"]),
});
const ALL_NODE_KEYS = new Set(["kind", "value", "ref", "op", "args"]);

interface CanonicalState<R extends JsonValue> extends ValidationState {
  readonly limits: ExpressionLimits;
  readonly options: CanonicalizeExpressionOptions<R>;
}

/** Validate unknown input and return a deeply frozen, canonical expression snapshot. */
export function canonicalizeExpression<R extends JsonValue = string>(
  input: unknown,
  options: CanonicalizeExpressionOptions<R> = {},
): Result<ValueExpression<R>> {
  let limits: ExpressionLimits;
  try {
    limits = resolveLimits(options.limits);
  } catch {
    return failure("EXPRESSION_LIMIT_EXCEEDED", []);
  }
  const state: CanonicalState<R> = {
    limits,
    options,
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
    maxStringLength: limits.maxStringLength,
    nodes: 0,
    active: new WeakSet(),
  };
  try {
    return success(canonicalizeNode(input, [], 0, state));
  } catch (error) {
    const problem =
      error instanceof ExpressionFailure
        ? error
        : new ExpressionFailure("EXPRESSION_INVALID_INPUT", []);
    return failure(problem.code, problem.expressionPath);
  }
}

function canonicalizeNode<R extends JsonValue>(
  input: unknown,
  path: ExpressionPath,
  depth: number,
  state: CanonicalState<R>,
): ValueExpression<R> {
  countNode(path, depth, state);
  if (typeof input !== "object" || input === null)
    throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", path);
  if (state.active.has(input)) throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", path);
  state.active.add(input);
  try {
    const initial = dataProperties(input, path, ALL_NODE_KEYS, 3);
    const kind = initial.kind;
    if (kind !== "literal" && kind !== "ref" && kind !== "op") {
      throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", [...path, "kind"]);
    }
    const properties = selectNodeProperties(initial, path, NODE_KEYS[kind]);
    if (kind === "literal") return canonicalLiteral(properties, path, depth, state);
    if (kind === "ref") return canonicalReference(properties, path, depth, state);
    return canonicalOperator(properties, path, depth, state);
  } finally {
    state.active.delete(input);
  }
}

function selectNodeProperties(
  properties: Readonly<Record<string, unknown>>,
  path: ExpressionPath,
  allowed: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  for (const key of Object.keys(properties)) {
    if (!allowed.has(key)) throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", [...path, key]);
  }
  return properties;
}

function countNode(
  path: ExpressionPath,
  depth: number,
  state: ValidationState & { readonly limits: ExpressionLimits },
): void {
  state.nodes += 1;
  if (depth > state.limits.maxDepth || state.nodes > state.limits.maxNodes) {
    throw new ExpressionFailure("EXPRESSION_LIMIT_EXCEEDED", path);
  }
}

function canonicalLiteral<R extends JsonValue>(
  properties: Readonly<Record<string, unknown>>,
  path: ExpressionPath,
  depth: number,
  state: CanonicalState<R>,
): ValueExpression<R> {
  if (!("value" in properties))
    throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", [...path, "value"]);
  const value = cloneJson(properties.value, [...path, "value"], depth + 1, state);
  return Object.freeze({ kind: "literal", value });
}

function canonicalReference<R extends JsonValue>(
  properties: Readonly<Record<string, unknown>>,
  path: ExpressionPath,
  depth: number,
  state: CanonicalState<R>,
): ValueExpression<R> {
  if (!("ref" in properties))
    throw new ExpressionFailure("EXPRESSION_INVALID_REFERENCE", [...path, "ref"]);
  const refPath = [...path, "ref"];
  const raw = properties.ref;
  const codec = state.options.reference;
  if (
    !codec &&
    typeof raw === "string" &&
    exceedsStringLimit(raw, state.limits.maxReferenceLength)
  ) {
    throw new ExpressionFailure("EXPRESSION_LIMIT_EXCEEDED", refPath);
  }
  const cloned = cloneReference<R>(raw, refPath, depth + 1, state);
  if (codec ? !safeValidate(codec.validate, cloned) : !defaultReference(cloned)) {
    throw new ExpressionFailure("EXPRESSION_INVALID_REFERENCE", refPath);
  }
  if (referenceExceedsLength(cloned, state.limits.maxReferenceLength)) {
    throw new ExpressionFailure("EXPRESSION_LIMIT_EXCEEDED", refPath);
  }
  if (!codec?.canonicalize) return Object.freeze({ kind: "ref", ref: cloned });
  const replacement = canonicalReferenceValue(cloned, codec.canonicalize, refPath);
  const output = cloneReference<R>(replacement, refPath, depth + 1, state);
  if (!safeValidate(codec.validate, output))
    throw new ExpressionFailure("EXPRESSION_INVALID_REFERENCE", refPath);
  if (referenceExceedsLength(output, state.limits.maxReferenceLength)) {
    throw new ExpressionFailure("EXPRESSION_LIMIT_EXCEEDED", refPath);
  }
  return Object.freeze({ kind: "ref", ref: output });
}

function cloneReference<R extends JsonValue>(
  input: unknown,
  path: ExpressionPath,
  depth: number,
  state: CanonicalState<R>,
): R {
  try {
    return cloneJson(input, path, depth, state) as R;
  } catch (error) {
    if (error instanceof ExpressionFailure && error.code === "EXPRESSION_LIMIT_EXCEEDED")
      throw error;
    throw new ExpressionFailure("EXPRESSION_INVALID_REFERENCE", path);
  }
}

function safeValidate<R>(validate: (input: unknown) => input is R, input: unknown): input is R {
  try {
    return validate(input) === true;
  } catch {
    return false;
  }
}

function defaultReference(input: unknown): input is string {
  return typeof input === "string" && input.length > 0;
}

function canonicalReferenceValue<R extends JsonValue>(
  reference: R,
  canonicalize: (reference: R) => R,
  path: ExpressionPath,
): R {
  try {
    return canonicalize(reference);
  } catch {
    throw new ExpressionFailure("EXPRESSION_INVALID_REFERENCE", path);
  }
}

function canonicalOperator<R extends JsonValue>(
  properties: Readonly<Record<string, unknown>>,
  path: ExpressionPath,
  depth: number,
  state: CanonicalState<R>,
): ValueExpression<R> {
  if (typeof properties.op !== "string" || !Array.isArray(properties.args)) {
    throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", path);
  }
  if (
    properties.op.length === 0 ||
    exceedsStringLimit(properties.op, state.limits.maxStringLength)
  ) {
    throw new ExpressionFailure("EXPRESSION_LIMIT_EXCEEDED", [...path, "op"]);
  }
  const args = canonicalArgs(properties.args, path, depth, state);
  return Object.freeze({ kind: "op", op: properties.op, args });
}

function canonicalArgs<R extends JsonValue>(
  input: unknown[],
  path: ExpressionPath,
  depth: number,
  state: CanonicalState<R>,
): readonly ValueExpression<R>[] {
  const argsPath = [...path, "args"];
  const length = arrayLength(input, argsPath);
  if (length > state.limits.maxArgs || length > state.maxNodes - state.nodes) {
    throw new ExpressionFailure("EXPRESSION_LIMIT_EXCEEDED", argsPath);
  }
  validateArrayKeys(input, argsPath, length);
  const output: ValueExpression<R>[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = arrayElement(input, index, argsPath);
    output.push(canonicalizeNode(descriptor.value, [...argsPath, index], depth + 1, state));
  }
  return Object.freeze(output);
}

function validateArrayKeys(input: unknown[], path: ExpressionPath, length: number): void {
  try {
    const keys = Reflect.ownKeys(input);
    if (keys.length !== length + 1) throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", path);
  } catch (error) {
    if (error instanceof ExpressionFailure) throw error;
    throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", path);
  }
}

function arrayElement(
  input: unknown[],
  index: number,
  path: ExpressionPath,
): PropertyDescriptor & { value: unknown } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", [...path, index]);
    }
    return descriptor as PropertyDescriptor & { value: unknown };
  } catch (error) {
    if (error instanceof ExpressionFailure) throw error;
    throw new ExpressionFailure("EXPRESSION_INVALID_INPUT", [...path, index]);
  }
}

export function referenceIdentity(reference: JsonValue): string {
  return stableJson(reference);
}

function referenceExceedsLength(reference: JsonValue, maxLength: number): boolean {
  return typeof reference === "string"
    ? exceedsStringLimit(reference, maxLength)
    : stableJson(reference).length > maxLength;
}

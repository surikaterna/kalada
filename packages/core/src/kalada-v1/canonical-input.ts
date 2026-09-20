import { KaladaFailure } from "./diagnostics.js";
import {
  canonicalJsonIdentity,
  cloneJson,
  cloneJsonWithStats,
  dataValue,
  type JsonValue,
} from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import type { KaladaV1Limits, KaladaV1Options } from "./types.js";

export type Path = readonly (string | number)[];
export interface CanonicalState<R extends JsonValue> {
  readonly limits: ResolvedKaladaV1Limits;
  readonly options: KaladaV1Options<R>;
  readonly active: WeakSet<object>;
  astNodes: number;
  valueNodes: number;
}

export function properties(
  input: unknown,
  path: Path,
  allowed: ReadonlySet<string>,
  requireExact = true,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, String(key)]);
    }
    try {
      output[key] = dataValue(input, key);
    } catch {
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, key]);
    }
  }
  if (requireExact && keys.length !== allowed.size) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  return output;
}

export function exact(
  raw: Record<string, unknown>,
  path: Path,
  keys: readonly string[],
  optionalLast = false,
): void {
  const minimum = optionalLast ? keys.length - 1 : keys.length;
  if (Object.keys(raw).length < minimum || Object.keys(raw).length > keys.length) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  for (let index = 0; index < minimum; index += 1) {
    const key = keys[index];
    if (key !== undefined && !(key in raw)) {
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, key]);
    }
  }
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, key]);
  }
}

export function strictArray(input: unknown[], path: Path): unknown[] {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  if (keys.length !== input.length + 1) throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  return Array.from({ length: input.length }, (_, index) => {
    try {
      return dataValue(input, String(index));
    } catch {
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, index]);
    }
  });
}

export function safeJson<R extends JsonValue>(
  input: unknown,
  path: Path,
  state: CanonicalState<R>,
): JsonValue {
  try {
    const result = cloneJsonWithStats(input, {
      maxDepth: state.limits.maxValueDepth,
      maxNodes: state.limits.maxValueNodes - state.valueNodes,
      maxStringLength: state.limits.maxStringLength,
    });
    state.valueNodes += result.nodes;
    return result.value;
  } catch (error) {
    if (error instanceof RangeError) throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
}

export function inspectJson<R extends JsonValue>(
  input: unknown,
  path: Path,
  state: CanonicalState<R>,
): JsonValue {
  try {
    return cloneJson(input, {
      maxDepth: state.limits.maxValueDepth,
      maxNodes: state.limits.maxValueNodes,
      maxStringLength: state.limits.maxStringLength,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
}

export function referenceLength(reference: JsonValue): number {
  return typeof reference === "string"
    ? [...reference].length
    : [...canonicalJsonIdentity(reference)].length;
}

export function bindingName(input: unknown, path: Path, limits: KaladaV1Limits): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  if ([...input].length > limits.maxReferenceLength) {
    throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
  }
  return input;
}

export function fieldName(input: unknown, path: Path, limits: KaladaV1Limits): string {
  if (typeof input !== "string") throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  if ([...input].length > limits.maxStringLength) {
    throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
  }
  return input;
}

export function safeValidate<R>(
  validate: (input: unknown) => input is R,
  input: unknown,
): input is R {
  try {
    return validate(input) === true;
  } catch {
    return false;
  }
}

export function safeCanonicalize<R>(canonicalize: (input: R) => R, input: R, path: Path): R {
  try {
    return canonicalize(input);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_REFERENCE", path);
  }
}

export function count<R extends JsonValue>(
  path: Path,
  depth: number,
  state: CanonicalState<R>,
): void {
  state.astNodes += 1;
  if (depth > state.limits.maxAstDepth || state.astNodes > state.limits.maxAstNodes) {
    throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
  }
}

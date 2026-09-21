import type { SerializableValue } from "./contracts.js";
import type { HostPath } from "./editor-types.js";

export interface SerializableLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCollectionSize: number;
  readonly maxStringLength: number;
}

export const DEFAULT_SERIALIZABLE_LIMITS: SerializableLimits = Object.freeze({
  maxDepth: 32,
  maxNodes: 10_000,
  maxCollectionSize: 10_000,
  maxStringLength: 100_000,
});

export type SerializableCloneResult =
  | Readonly<{ ok: true; value: SerializableValue }>
  | Readonly<{
      ok: false;
      reason: "invalid-value" | "accessor" | "cycle" | "depth-limit" | "size-limit";
      path: HostPath;
    }>;

type ShallowRecordResult =
  | Readonly<{ ok: true; value: Record<string, unknown> }>
  | Readonly<{ ok: false; reason: "invalid-value" | "accessor" | "size-limit" }>;

type ReflectionResult<Value> = Readonly<{ ok: true; value: Value }> | Readonly<{ ok: false }>;

interface CloneState {
  readonly limits: SerializableLimits;
  readonly active: WeakSet<object>;
  nodes: number;
}

export function readOwnDataRecord(input: unknown, maximumKeys = 10_000): ShallowRecordResult {
  if (typeof input !== "object" || input === null) return shallowFailure("invalid-value");
  const array = safelyReflect(() => Array.isArray(input));
  if (!array.ok || array.value) return shallowFailure("invalid-value");
  const prototype = safelyReflect(() => Object.getPrototypeOf(input));
  if (!prototype.ok || (prototype.value !== Object.prototype && prototype.value !== null)) {
    return shallowFailure("invalid-value");
  }
  const keys = safelyReflect(() => Reflect.ownKeys(input));
  if (!keys.ok) return shallowFailure("invalid-value");
  if (keys.value.length > maximumKeys) return shallowFailure("size-limit");
  return readRecordDescriptors(input, keys.value);
}

export function cloneSerializableData(
  input: unknown,
  limits: SerializableLimits = DEFAULT_SERIALIZABLE_LIMITS,
): SerializableCloneResult {
  const state: CloneState = { limits, active: new WeakSet(), nodes: 0 };
  return cloneValue(input, Object.freeze([]), 0, state);
}

function cloneValue(
  input: unknown,
  path: HostPath,
  depth: number,
  state: CloneState,
): SerializableCloneResult {
  if (depth > state.limits.maxDepth) return failure("depth-limit", path);
  if (typeof input === "string") return cloneString(input, path, state.limits);
  if (input === null || typeof input === "boolean") return success(input);
  if (typeof input === "number") {
    return Number.isFinite(input) ? success(input) : failure("invalid-value", path);
  }
  if (typeof input !== "object") return failure("invalid-value", path);
  const array = safelyReflect(() => Array.isArray(input));
  if (!array.ok) return failure("invalid-value", path);
  if (state.active.has(input)) return failure("cycle", path);
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) return failure("size-limit", path);
  state.active.add(input);
  const result = array.value
    ? cloneArray(input as readonly unknown[], path, depth, state)
    : cloneRecord(input, path, depth, state);
  state.active.delete(input);
  return result;
}

function cloneArray(
  input: readonly unknown[],
  path: HostPath,
  depth: number,
  state: CloneState,
): SerializableCloneResult {
  const lengthDescriptor = ownDescriptor(input, "length");
  if (!lengthDescriptor.ok) return failure("invalid-value", path);
  if (!lengthDescriptor.value || !("value" in lengthDescriptor.value)) {
    return failure("accessor", path);
  }
  const length = lengthDescriptor.value.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > state.limits.maxCollectionSize
  ) {
    return failure("size-limit", path);
  }
  const output: SerializableValue[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = ownDescriptor(input, String(index));
    const childPath = Object.freeze([...path, index]);
    if (!descriptor.ok) return failure("invalid-value", childPath);
    if (!descriptor.value || !("value" in descriptor.value)) return failure("accessor", childPath);
    const cloned = cloneValue(descriptor.value.value, childPath, depth + 1, state);
    if (!cloned.ok) return cloned;
    output.push(cloned.value);
  }
  return success(Object.freeze(output));
}

function cloneRecord(
  input: object,
  path: HostPath,
  depth: number,
  state: CloneState,
): SerializableCloneResult {
  const inspected = readOwnDataRecord(input, state.limits.maxCollectionSize);
  if (!inspected.ok) return failure(inspected.reason, path);
  const output: Record<string, SerializableValue> = Object.create(null);
  for (const [key, value] of Object.entries(inspected.value)) {
    const keyResult = cloneString(key, path, state.limits);
    if (!keyResult.ok) return keyResult;
    const childPath = Object.freeze([...path, key]);
    const cloned = cloneValue(value, childPath, depth + 1, state);
    if (!cloned.ok) return cloned;
    output[key] = cloned.value;
  }
  return success(Object.freeze(output));
}

function readRecordDescriptors(input: object, keys: readonly PropertyKey[]): ShallowRecordResult {
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") return shallowFailure("invalid-value");
    const descriptor = ownDescriptor(input, key);
    if (!descriptor.ok) return shallowFailure("invalid-value");
    if (!descriptor.value || !("value" in descriptor.value)) return shallowFailure("accessor");
    output[key] = descriptor.value.value;
  }
  return Object.freeze({ ok: true, value: output });
}

function ownDescriptor(
  input: object,
  key: PropertyKey,
): ReflectionResult<PropertyDescriptor | undefined> {
  return safelyReflect(() => Object.getOwnPropertyDescriptor(input, key));
}

function safelyReflect<Value>(operation: () => Value): ReflectionResult<Value> {
  try {
    return { ok: true, value: operation() };
  } catch {
    return { ok: false };
  }
}

function shallowFailure(
  reason: Extract<ShallowRecordResult, { ok: false }>["reason"],
): ShallowRecordResult {
  return Object.freeze({ ok: false, reason });
}

function cloneString(
  input: string,
  path: HostPath,
  limits: SerializableLimits,
): SerializableCloneResult {
  return input.length <= limits.maxStringLength ? success(input) : failure("size-limit", path);
}

function success(value: SerializableValue): SerializableCloneResult {
  return Object.freeze({ ok: true, value });
}

function failure(
  reason: Extract<SerializableCloneResult, { ok: false }>["reason"],
  path: HostPath,
): SerializableCloneResult {
  return Object.freeze({ ok: false, reason, path: Object.freeze([...path]) });
}

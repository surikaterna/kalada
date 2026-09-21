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

interface CloneState {
  readonly limits: SerializableLimits;
  readonly active: WeakSet<object>;
  nodes: number;
}

export function readOwnDataRecord(input: unknown, maximumKeys = 10_000): ShallowRecordResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Object.freeze({ ok: false, reason: "invalid-value" });
  }
  try {
    const keys = Reflect.ownKeys(input);
    if (keys.length > maximumKeys) return Object.freeze({ ok: false, reason: "size-limit" });
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") return Object.freeze({ ok: false, reason: "invalid-value" });
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor))
        return Object.freeze({ ok: false, reason: "accessor" });
      output[key] = descriptor.value;
    }
    return Object.freeze({ ok: true, value: output });
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-value" });
  }
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
  if (state.active.has(input)) return failure("cycle", path);
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) return failure("size-limit", path);
  state.active.add(input);
  const result = Array.isArray(input)
    ? cloneArray(input, path, depth, state)
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
  if (input.length > state.limits.maxCollectionSize) return failure("size-limit", path);
  const output: SerializableValue[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = safeDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) return failure("accessor", [...path, index]);
    const cloned = cloneValue(descriptor.value, Object.freeze([...path, index]), depth + 1, state);
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
    const keyResult = cloneString(key, [...path, key], state.limits);
    if (!keyResult.ok) return keyResult;
    const cloned = cloneValue(value, Object.freeze([...path, key]), depth + 1, state);
    if (!cloned.ok) return cloned;
    output[key] = cloned.value;
  }
  return success(Object.freeze(output));
}

function safeDescriptor(input: object, key: string): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    return undefined;
  }
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

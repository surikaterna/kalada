export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

interface CloneState {
  readonly active: WeakSet<object>;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringLength: number;
  nodes: number;
}

export interface JsonCloneLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringLength: number;
}

export function cloneJson(input: unknown, limits: JsonCloneLimits): JsonValue {
  return cloneValue(input, 0, {
    ...limits,
    active: new WeakSet(),
    nodes: 0,
  });
}

function cloneValue(input: unknown, depth: number, state: CloneState): JsonValue {
  state.nodes += 1;
  if (depth > state.maxDepth || state.nodes > state.maxNodes) throw new RangeError("limit");
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "string") {
    if ([...input].length > state.maxStringLength) throw new RangeError("limit");
    return input;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypeError("json");
    return Object.is(input, -0) ? 0 : input;
  }
  if (typeof input !== "object") throw new TypeError("json");
  return cloneObject(input, depth, state);
}

function cloneObject(input: object, depth: number, state: CloneState): JsonValue {
  if (state.active.has(input)) throw new TypeError("cycle");
  state.active.add(input);
  try {
    return Array.isArray(input)
      ? cloneArray(input, depth, state)
      : cloneRecord(input, depth, state);
  } finally {
    state.active.delete(input);
  }
}

function cloneArray(input: unknown[], depth: number, state: CloneState): JsonValue[] {
  const keys = safeKeys(input);
  if (keys.length !== input.length + 1 || !keys.includes("length")) throw new TypeError("array");
  const output: JsonValue[] = [];
  for (let index = 0; index < input.length; index += 1) {
    output.push(cloneValue(dataValue(input, String(index)), depth + 1, state));
  }
  return Object.freeze(output) as JsonValue[];
}

function cloneRecord(input: object, depth: number, state: CloneState): { [key: string]: JsonValue } {
  const prototype = safePrototype(input);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("object");
  const output = Object.create(null) as Record<string, JsonValue>;
  for (const key of safeKeys(input)) {
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) throw new TypeError("key");
    if ([...key].length > state.maxStringLength) throw new RangeError("limit");
    output[key] = cloneValue(dataValue(input, key), depth + 1, state);
  }
  return Object.freeze(output);
}

function safeKeys(input: object): PropertyKey[] {
  try {
    return Reflect.ownKeys(input);
  } catch {
    throw new TypeError("object");
  }
}

function safePrototype(input: object): object | null {
  try {
    return Object.getPrototypeOf(input);
  } catch {
    throw new TypeError("object");
  }
}

export function dataValue(input: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key);
  } catch {
    throw new TypeError("descriptor");
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("descriptor");
  }
  return descriptor.value;
}

export function deepEqualJson(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && equalArrays(left, right);
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => key in right && deepEqualJson(left[key]!, right[key]!))
  );
}

function equalArrays(left: JsonValue[], right: JsonValue[]): boolean {
  return left.length === right.length && left.every((value, index) => deepEqualJson(value, right[index]!));
}

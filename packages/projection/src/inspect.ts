import { ProjectionFailure } from "./diagnostics.js";
import type { ProjectionPath } from "./types.js";

type Fields = Record<string, unknown>;

export function inspectRecord(
  input: unknown,
  path: ProjectionPath,
  required: readonly string[],
  optional: readonly string[] = [],
  extraAtKey = false,
): Fields {
  if (typeof input !== "object" || input === null || safe(() => Array.isArray(input), path)) {
    invalid(path);
  }
  const object = input as object;
  const allowed = new Set([...required, ...optional]);
  const keys = safe(() => Reflect.ownKeys(object), path);
  const prototype = safe(() => Object.getPrototypeOf(object), path);
  if (prototype !== null && prototype !== Object.prototype) invalid(path);
  validateKeys(keys, allowed, path, extraAtKey);
  const fields: Fields = Object.create(null) as Fields;
  for (const key of required) fields[key] = readData(object, key, [...path, key], true);
  for (const key of optional) {
    const value = readData(object, key, [...path, key], false);
    if (value !== ABSENT) fields[key] = value;
  }
  return fields;
}

const ABSENT = Symbol("absent");

function validateKeys(
  keys: readonly PropertyKey[],
  allowed: ReadonlySet<string>,
  path: ProjectionPath,
  extraAtKey: boolean,
): void {
  for (const key of keys) {
    if (typeof key !== "string") invalid(path);
    if (!allowed.has(key)) invalid(extraAtKey ? [...path, key] : path);
  }
}

function readData(object: object, key: string, path: ProjectionPath, required: boolean): unknown {
  const descriptor = safe(() => Object.getOwnPropertyDescriptor(object, key), path);
  if (descriptor === undefined) {
    if (required) invalid(path);
    return ABSENT;
  }
  if (!("value" in descriptor) || !descriptor.enumerable) invalid(path);
  return descriptor.value;
}

export function inspectArray(input: unknown, path: ProjectionPath): readonly unknown[] {
  if (!safe(() => Array.isArray(input), path)) invalid(path);
  const array = input as unknown[];
  const prototype = safe(() => Object.getPrototypeOf(array), path);
  if (prototype !== Array.prototype) invalid(path);
  const lengthDescriptor = safe(() => Object.getOwnPropertyDescriptor(array, "length"), path);
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) invalid(path);
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) invalid(path);
  const keys = safe(() => Reflect.ownKeys(array), path);
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isArraySlot(key, length)) invalid(path);
  }
  return snapshotArray(array, length, path);
}

function snapshotArray(array: readonly unknown[], length: number, path: ProjectionPath): unknown[] {
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = safe(
      () => Object.getOwnPropertyDescriptor(array, String(index)),
      [...path, index],
    );
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      invalid([...path, index]);
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function isArraySlot(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function safe<T>(operation: () => T, path: ProjectionPath): T {
  try {
    return operation();
  } catch {
    invalid(path);
  }
}

export function invalid(path: ProjectionPath): never {
  throw new ProjectionFailure("PROJECTION_INVALID_INPUT", path);
}

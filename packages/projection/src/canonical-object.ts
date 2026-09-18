import { ProjectionFailure } from "./diagnostics.js";
import { inspectRecordShape, inspectRequiredData, invalid } from "./inspect.js";
import type { ProjectionPath } from "./types.js";

export interface PreparedProjectionEntry {
  readonly key: string;
  readonly input: unknown;
}

export function prepareProjectionEntry(
  input: unknown,
  path: ProjectionPath,
  maximumKeyLength: number,
  seen: Set<string>,
): PreparedProjectionEntry {
  const object = inspectRecordShape(input, path, ["key", "value"]);
  const keyPath = [...path, "key"];
  const key = inspectRequiredData(object, "key", keyPath);
  if (typeof key !== "string" || key.length === 0) invalid(keyPath);
  if (codePointLengthAbove(key, maximumKeyLength)) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", keyPath);
  }
  if (isUnsafeKey(key)) throw new ProjectionFailure("PROJECTION_UNSAFE_KEY", keyPath);
  if (seen.has(key)) throw new ProjectionFailure("PROJECTION_DUPLICATE_KEY", keyPath);
  seen.add(key);
  const value = inspectRequiredData(object, "value", [...path, "value"]);
  return Object.freeze({ key, input: value });
}

export function codePointLengthAbove(value: string, maximum: number): boolean {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > maximum) return true;
  }
  return false;
}

function isUnsafeKey(key: string): boolean {
  if (key === "__proto__" || key === "prototype" || key === "constructor") return true;
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) return false;
  return Number(key) <= 4_294_967_294;
}

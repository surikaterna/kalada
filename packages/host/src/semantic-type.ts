import type { KaladaSyntaxStaticType } from "@kalada/syntax";
import { cloneSerializableData, readOwnDataRecord } from "./serializable.js";

export type SemanticTypeResult =
  | Readonly<{ ok: true; value: KaladaSyntaxStaticType }>
  | Readonly<{ ok: false }>;

const primitiveNames = new Set([
  "null",
  "boolean",
  "number",
  "string",
  "json",
  "Instant",
  "Duration",
]);

export function cloneSemanticType(input: unknown): SemanticTypeResult {
  if (input === "dynamic") return Object.freeze({ ok: true, value: "dynamic" });
  const cloned = cloneSerializableData(input);
  if (!cloned.ok || !isKaladaType(cloned.value, 0)) return Object.freeze({ ok: false });
  return Object.freeze({ ok: true, value: cloned.value as KaladaSyntaxStaticType });
}

function isKaladaType(input: unknown, depth: number): boolean {
  if (depth > 32) return false;
  const inspected = readOwnDataRecord(input, 64);
  if (!inspected.ok || typeof inspected.value.kind !== "string") return false;
  const record = inspected.value;
  if (record.kind === "primitive-type") return isPrimitive(record);
  if (record.kind === "array-type") return isUnary(record, "element", depth);
  if (record.kind === "option-type") return isUnary(record, "value", depth);
  if (record.kind === "result-type") return isResult(record, depth);
  if (record.kind === "function-type") return isFunction(record, depth);
  return false;
}

function isPrimitive(record: Record<string, unknown>): boolean {
  return exactKeys(record, ["kind", "name"]) && primitiveNames.has(record.name as string);
}

function isUnary(record: Record<string, unknown>, field: string, depth: number): boolean {
  return exactKeys(record, ["kind", field]) && isKaladaType(record[field], depth + 1);
}

function isResult(record: Record<string, unknown>, depth: number): boolean {
  return (
    exactKeys(record, ["kind", "ok", "error"]) &&
    isKaladaType(record.ok, depth + 1) &&
    isKaladaType(record.error, depth + 1)
  );
}

function isFunction(record: Record<string, unknown>, depth: number): boolean {
  if (!exactKeys(record, ["kind", "parameters", "returns"])) return false;
  if (!Array.isArray(record.parameters)) return false;
  return (
    record.parameters.every((parameter) => isKaladaType(parameter, depth + 1)) &&
    isKaladaType(record.returns, depth + 1)
  );
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

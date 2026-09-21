import type { JsonValue, KaladaType } from "@kalada/core";
import { deepFreeze } from "./freeze.js";

export interface StaticOption {
  readonly shape: "option";
  readonly value: StaticType;
}

export type StaticType = "dynamic" | KaladaType | StaticOption;

export function projectStaticType(type: StaticType): "dynamic" | KaladaType {
  if (type === "dynamic") return type;
  if (!("shape" in type)) return type;
  const value = projectStaticType(type.value);
  return value === "dynamic" ? "dynamic" : deepFreeze({ kind: "option-type", value });
}

export const primitive = (
  name: Extract<KaladaType, { kind: "primitive-type" }>["name"],
): KaladaType => Object.freeze({ kind: "primitive-type", name });

export function literalType(value: JsonValue): KaladaType {
  if (value === null) return primitive("null");
  return primitive(typeof value as "boolean" | "number" | "string");
}

export function readStaticType(input: unknown, maxDepth: number): StaticType | null {
  if (input === "dynamic") return "dynamic";
  return readType(input, 1, maxDepth);
}

function readType(input: unknown, depth: number, maximum: number): KaladaType | null {
  if (depth > maximum) return null;
  const record = ownRecord(input);
  if (record === null || typeof record.kind !== "string") return null;
  if (record.kind === "primitive-type") return readExactPrimitive(record);
  if (record.kind === "array-type" || record.kind === "option-type")
    return readCollection(record, depth, maximum);
  if (record.kind === "result-type") return readExactResult(record, depth, maximum);
  if (record.kind === "function-type") return readExactFunction(record, depth, maximum);
  return null;
}

function readExactPrimitive(record: Record<string, unknown>): KaladaType | null {
  return exactKeys(record, ["kind", "name"]) ? readPrimitive(record) : null;
}

function readCollection(
  record: Record<string, unknown>,
  depth: number,
  maximum: number,
): KaladaType | null {
  const array = record.kind === "array-type";
  const field = array ? "element" : "value";
  if (!exactKeys(record, ["kind", field])) return null;
  const value = readType(record[field], depth + 1, maximum);
  return value ? (deepFreeze({ kind: record.kind, [field]: value }) as KaladaType) : null;
}

function readExactResult(
  record: Record<string, unknown>,
  depth: number,
  maximum: number,
): KaladaType | null {
  return exactKeys(record, ["kind", "ok", "error"]) ? readResult(record, depth, maximum) : null;
}

function readExactFunction(
  record: Record<string, unknown>,
  depth: number,
  maximum: number,
): KaladaType | null {
  return exactKeys(record, ["kind", "parameters", "returns"])
    ? readFunction(record, depth, maximum)
    : null;
}

function readPrimitive(record: Record<string, unknown>): KaladaType | null {
  const names = ["null", "boolean", "number", "string", "json", "Instant", "Duration"];
  if (!names.includes(String(record.name))) return null;
  return primitive(record.name as Extract<KaladaType, { kind: "primitive-type" }>["name"]);
}

function readResult(
  record: Record<string, unknown>,
  depth: number,
  maximum: number,
): KaladaType | null {
  const ok = readType(record.ok, depth + 1, maximum);
  const error = readType(record.error, depth + 1, maximum);
  return ok && error ? deepFreeze({ kind: "result-type", ok, error }) : null;
}

function readFunction(
  record: Record<string, unknown>,
  depth: number,
  maximum: number,
): KaladaType | null {
  if (!Array.isArray(record.parameters)) return null;
  const parameters: KaladaType[] = [];
  for (const parameter of record.parameters) {
    const found = readType(parameter, depth + 1, maximum);
    if (found === null) return null;
    parameters.push(found);
  }
  const returns = readType(record.returns, depth + 1, maximum);
  return returns ? deepFreeze({ kind: "function-type", parameters, returns }) : null;
}

function ownRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const output: Record<string, unknown> = Object.create(null);
  try {
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) return null;
      output[key] = descriptor.value;
    }
  } catch {
    return null;
  }
  return output;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

export function typeIs(type: StaticType, name: string): boolean {
  return (
    type !== "dynamic" && !("shape" in type) && type.kind === "primitive-type" && type.name === name
  );
}

export function isCallable(type: StaticType): boolean {
  return type !== "dynamic" && !("shape" in type) && type.kind === "function-type";
}

export function isOption(
  type: StaticType,
): type is Extract<KaladaType, { kind: "option-type" }> | StaticOption {
  return (
    type !== "dynamic" &&
    (("shape" in type && type.shape === "option") ||
      (!("shape" in type) && type.kind === "option-type"))
  );
}

export function equalTypes(left: StaticType, right: StaticType): boolean {
  return (
    left === right ||
    (left !== "dynamic" && right !== "dynamic" && JSON.stringify(left) === JSON.stringify(right))
  );
}

export function joinTypes(left: StaticType, right: StaticType): StaticType | null {
  if (equalTypes(left, right)) return left;
  if (left === "dynamic" || right === "dynamic") return "dynamic";
  if (
    !("shape" in left) &&
    !("shape" in right) &&
    isJsonCompatible(left) &&
    isJsonCompatible(right)
  )
    return primitive("json");
  return null;
}

function isJsonCompatible(type: KaladaType): boolean {
  if (type.kind === "array-type") return isJsonCompatible(type.element);
  return (
    type.kind === "primitive-type" &&
    ["null", "boolean", "number", "string", "json"].includes(type.name)
  );
}

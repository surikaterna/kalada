import type { JsonValue } from "./json.js";
import type { KaladaFunctionType, KaladaType } from "./types.js";

export const DYNAMIC = Symbol("dynamic");
export type Dynamic = typeof DYNAMIC;
export interface OptionShape {
  readonly shape: "option";
  readonly value: StaticType;
}
export interface ResultShape {
  readonly shape: "result";
  readonly ok: StaticType;
  readonly error: StaticType;
}
export interface UnionShape {
  readonly shape: "union";
  readonly members: readonly StaticType[];
}
export type StaticType = KaladaType | Dynamic | OptionShape | ResultShape | UnionShape;
export type Scope = ReadonlyMap<string, StaticType>;

export function literalType(value: JsonValue): KaladaType {
  if (Array.isArray(value)) {
    return Object.freeze({ kind: "array-type", element: primitive("json") });
  }
  return primitive(
    value === null
      ? "null"
      : typeof value === "object"
        ? "json"
        : (typeof value as "boolean" | "number" | "string"),
  );
}

export function primitive(
  name: "null" | "boolean" | "number" | "string" | "json" | "Instant" | "Duration",
): KaladaType {
  return Object.freeze({ kind: "primitive-type", name });
}

export function isFunctionType(value: StaticType): value is KaladaFunctionType {
  return value !== DYNAMIC && !isShape(value) && value.kind === "function-type";
}

export function isPrimitive(value: StaticType, name: string): boolean {
  return (
    value !== DYNAMIC && !isShape(value) && value.kind === "primitive-type" && value.name === name
  );
}

export function isShape(value: StaticType): value is OptionShape | ResultShape | UnionShape {
  return value !== DYNAMIC && "shape" in value;
}

export function isOptionShape(value: StaticType): value is OptionShape {
  return isShape(value) && value.shape === "option";
}

export function isResultShape(value: StaticType): value is ResultShape {
  return isShape(value) && value.shape === "result";
}

export function isUnion(value: StaticType): value is UnionShape {
  return isShape(value) && value.shape === "union";
}

export function staticEqual(left: StaticType, right: StaticType): boolean {
  if (left === DYNAMIC || right === DYNAMIC) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function union(members: readonly StaticType[]): UnionShape {
  return Object.freeze({ shape: "union", members: Object.freeze([...members]) });
}

export function equalType(left: KaladaType, right: KaladaType): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function merged(base: Scope, extra: Scope): Scope {
  return new Map([...base, ...extra]);
}

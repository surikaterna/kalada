import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import {
  DYNAMIC,
  isOptionShape,
  isPrimitive,
  isShape,
  primitive,
  type Scope,
  type StaticType,
  staticEqual,
} from "./static-type-model.js";
import type { KaladaType, KaladaV1Expression } from "./types.js";

type Path = readonly (string | number)[];
type Infer<R extends JsonValue> = (
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
) => StaticType;

export function inferControlType<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType | null {
  if (node.kind === "conditional") return conditionalType(node, path, scope, infer);
  if (node.kind === "option-coalesce") return coalesceType(node, path, scope, infer);
  return null;
}

function conditionalType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "conditional" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  const condition = infer(node.condition, [...path, "condition"], scope);
  if (condition !== DYNAMIC && !isPrimitive(condition, "boolean")) {
    fail("KALADA_OPERATOR_TYPE", [...path, "condition"]);
  }
  const thenType = infer(node.then, [...path, "then"], scope);
  const elseType = infer(node.else, [...path, "else"], scope);
  return joinBranches(thenType, elseType, [...path, "else"]);
}

function coalesceType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "option-coalesce" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  const option = infer(node.option, [...path, "option"], scope);
  const payload = optionPayload(option, [...path, "option"]);
  const fallback = infer(node.fallback, [...path, "fallback"], scope);
  return joinBranches(payload, fallback, [...path, "fallback"]);
}

function optionPayload(type: StaticType, path: Path): StaticType {
  if (type === DYNAMIC) return DYNAMIC;
  if (isOptionShape(type)) return type.value;
  if (!isShape(type) && type.kind === "option-type") return type.value;
  fail("KALADA_OPTION_REQUIRED", path);
}

function joinBranches(left: StaticType, right: StaticType, path: Path): StaticType {
  if (staticEqual(left, right)) return left;
  if (left === DYNAMIC || right === DYNAMIC) return DYNAMIC;
  if (isJsonCompatible(left) && isJsonCompatible(right)) return primitive("json");
  fail("KALADA_OPERATOR_TYPE", path);
}

function isJsonCompatible(type: StaticType): boolean {
  if (type === DYNAMIC || isShape(type)) return false;
  if (type.kind === "array-type") return isJsonKaladaType(type.element);
  return type.kind === "primitive-type" && isJsonPrimitive(type.name);
}

function isJsonKaladaType(type: KaladaType): boolean {
  if (type.kind === "array-type") return isJsonKaladaType(type.element);
  return type.kind === "primitive-type" && isJsonPrimitive(type.name);
}

function isJsonPrimitive(name: string): boolean {
  return ["null", "boolean", "number", "string", "json"].includes(name);
}

function fail(code: ConstructorParameters<typeof KaladaFailure>[0], path: Path): never {
  throw new KaladaFailure(code, path);
}

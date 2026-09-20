import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import {
  DYNAMIC,
  isFunctionType,
  isPrimitive,
  isShape,
  primitive,
  type Scope,
  type StaticType,
} from "./static-type-model.js";
import type { KaladaType, KaladaV1Expression } from "./types.js";

type Path = readonly (string | number)[];
type Infer<R extends JsonValue> = (
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
) => StaticType;

export function inferOperatorType<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType | null {
  if (node.kind === "equality") return equalityType(node, path, scope, infer);
  if (node.kind === "ordered-comparison") return orderedType(node, path, scope, infer);
  if (node.kind === "membership") return membershipType(node, path, scope, infer);
  if (node.kind === "numeric-binary") return numericBinaryType(node, path, scope, infer);
  if (node.kind === "numeric-unary") return unaryType(node, path, scope, infer, "number");
  if (node.kind === "boolean-not") return unaryType(node, path, scope, infer, "boolean");
  if (node.kind === "boolean-logical" || node.kind === "boolean-xor") {
    return booleanBinaryType(node, path, scope, infer);
  }
  return null;
}

function numericBinaryType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "numeric-binary" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  requirePrimitive(infer(node.left, [...path, "left"], scope), "number", [...path, "left"]);
  requirePrimitive(infer(node.right, [...path, "right"], scope), "number", [...path, "right"]);
  return primitive("number");
}

function unaryType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "numeric-unary" | "boolean-not" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
  expected: "number" | "boolean",
): StaticType {
  requirePrimitive(infer(node.operand, [...path, "operand"], scope), expected, [
    ...path,
    "operand",
  ]);
  return primitive(expected);
}

function booleanBinaryType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "boolean-logical" | "boolean-xor" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  requirePrimitive(infer(node.left, [...path, "left"], scope), "boolean", [...path, "left"]);
  requirePrimitive(infer(node.right, [...path, "right"], scope), "boolean", [...path, "right"]);
  return primitive("boolean");
}

function requirePrimitive(type: StaticType, expected: "number" | "boolean", path: Path): void {
  if (type !== DYNAMIC && !isPrimitive(type, expected)) fail("KALADA_OPERATOR_TYPE", path);
}

function equalityType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "equality" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  const left = infer(node.left, [...path, "left"], scope);
  if (isFunctionType(left)) fail("KALADA_OPERATOR_TYPE", [...path, "left"]);
  const right = infer(node.right, [...path, "right"], scope);
  if (isFunctionType(right)) fail("KALADA_OPERATOR_TYPE", [...path, "right"]);
  return primitive("boolean");
}

function orderedType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "ordered-comparison" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  const left = infer(node.left, [...path, "left"], scope);
  requireOrdered(left, node.domain, [...path, "left"]);
  const right = infer(node.right, [...path, "right"], scope);
  requireOrdered(right, node.domain, [...path, "right"]);
  return primitive("boolean");
}

function requireOrdered(type: StaticType, domain: "number" | "string", path: Path): void {
  if (type !== DYNAMIC && !isPrimitive(type, domain)) fail("KALADA_OPERATOR_TYPE", path);
}

function membershipType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "membership" }>,
  path: Path,
  scope: Scope,
  infer: Infer<R>,
): StaticType {
  const needle = infer(node.needle, [...path, "needle"], scope);
  if (isFunctionType(needle)) fail("KALADA_OPERATOR_TYPE", [...path, "needle"]);
  const array = infer(node.array, [...path, "array"], scope);
  if (array !== DYNAMIC && (isShape(array) || array.kind !== "array-type")) {
    fail("KALADA_OPERATOR_TYPE", [...path, "array"]);
  }
  if (array !== DYNAMIC && !isShape(array) && containsFunction(array.element)) {
    fail("KALADA_OPERATOR_TYPE", [...path, "array"]);
  }
  return primitive("boolean");
}

function containsFunction(type: KaladaType): boolean {
  const work = [type];
  while (work.length > 0) {
    const current = work.pop() as KaladaType;
    if (current.kind === "function-type") return true;
    if (current.kind === "array-type") work.push(current.element);
    if (current.kind === "option-type") work.push(current.value);
    if (current.kind === "result-type") work.push(current.ok, current.error);
  }
  return false;
}

function fail(code: ConstructorParameters<typeof KaladaFailure>[0], path: Path): never {
  throw new KaladaFailure(code, path);
}

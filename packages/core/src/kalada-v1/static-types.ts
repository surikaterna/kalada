import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import { inferControlType } from "./static-control-types.js";
import { inferOperatorType } from "./static-operator-types.js";
import {
  DYNAMIC,
  equalType,
  isFunctionType,
  isOptionShape,
  isPrimitive,
  isResultShape,
  isShape,
  isUnion,
  literalType,
  merged,
  type OptionShape,
  primitive,
  type ResultShape,
  type Scope,
  type StaticType,
  staticEqual,
  union,
} from "./static-type-model.js";
import type { KaladaFunctionType, KaladaType, KaladaV1Expression, NamedFunction } from "./types.js";

type Path = readonly (string | number)[];
type AddedExpression<R extends JsonValue> = Extract<
  KaladaV1Expression<R>,
  {
    kind:
      | "field-access"
      | "optional-field-access"
      | "equality"
      | "ordered-comparison"
      | "membership"
      | "numeric-binary"
      | "numeric-unary"
      | "boolean-not"
      | "boolean-logical"
      | "boolean-xor"
      | "conditional"
      | "option-coalesce";
  }
>;

export function checkKaladaV1Types<R extends JsonValue>(expression: KaladaV1Expression<R>): void {
  infer(expression, ["expression"], new Map());
}

function infer<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
): StaticType {
  if (node.kind === "literal") return literalType(node.value);
  if (node.kind === "ref")
    return typeof node.ref === "string" ? (scope.get(node.ref) ?? DYNAMIC) : DYNAMIC;
  if (node.kind === "function") return checkFunction(node, path, scope);
  if (node.kind === "function-group") return checkGroup(node, path, scope);
  if (node.kind === "call") return checkCall(node, path, scope);
  if (node.kind === "core-function") return coreType(node.name);
  if (node.kind === "binding") return checkBinding(node, path, scope);
  if (isAddedExpression(node)) return inferAdded(node, path, scope);
  if (node.kind === "option") return optionType(node, path, scope);
  if (node.kind === "result") return resultType(node, path, scope);
  if (node.kind === "match") return checkMatch(node, path, scope);
  return inferTemporal(node, path, scope);
}

function inferAdded<R extends JsonValue>(
  node: AddedExpression<R>,
  path: Path,
  scope: Scope,
): StaticType {
  const control = inferControlType(node, path, scope, infer);
  if (control !== null) return control;
  if (node.kind === "field-access" || node.kind === "optional-field-access") {
    return fieldAccessType(node, path, scope);
  }
  return inferOperatorType(node, path, scope, infer) ?? invalidAdded(path);
}

function isAddedExpression<R extends JsonValue>(
  node: KaladaV1Expression<R>,
): node is AddedExpression<R> {
  return [
    "field-access",
    "optional-field-access",
    "equality",
    "ordered-comparison",
    "membership",
    "numeric-binary",
    "numeric-unary",
    "boolean-not",
    "boolean-logical",
    "boolean-xor",
    "conditional",
    "option-coalesce",
  ].includes(node.kind);
}

function invalidAdded(path: Path): never {
  throw new KaladaFailure("KALADA_INVALID_INPUT", path);
}

function fieldAccessType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "field-access" | "optional-field-access" }>,
  path: Path,
  scope: Scope,
): StaticType {
  const target = infer(node.target, [...path, "target"], scope);
  const optional = node.kind === "optional-field-access";
  if (!fieldTargetCanSucceed(target, optional)) {
    fail("KALADA_FIELD_TYPE_MISMATCH", [...path, "target"]);
  }
  const result = narrowFieldResult(node.target, node.field, optional);
  return optional ? Object.freeze({ shape: "option", value: result }) : result;
}

function narrowFieldResult<R extends JsonValue>(
  target: KaladaV1Expression<R>,
  field: string,
  optional: boolean,
): StaticType {
  if (target.kind === "literal") return literalFieldResult(target.value, field, optional);
  if (optional && target.kind === "option" && target.variant === "some") {
    const payload = target.value;
    if (payload.kind === "literal") return literalFieldResult(payload.value, field, true);
  }
  return DYNAMIC;
}

function literalFieldResult(value: JsonValue, field: string, optional: boolean): StaticType {
  if (value === null) return optional ? primitive("null") : DYNAMIC;
  if (typeof value !== "object" || Array.isArray(value)) return DYNAMIC;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor && "value" in descriptor ? literalType(descriptor.value as JsonValue) : DYNAMIC;
}

function fieldTargetCanSucceed(target: StaticType, optional: boolean): boolean {
  if (target === DYNAMIC) return true;
  if (isUnion(target))
    return target.members.some((member) => fieldTargetCanSucceed(member, optional));
  if (isOptionShape(target)) return optional && unwrappedFieldTargetCanSucceed(target.value);
  if (isShape(target)) return false;
  if (target.kind === "option-type") {
    return optional && unwrappedFieldTargetCanSucceed(target.value);
  }
  return isPrimitive(target, "json") || (optional && isPrimitive(target, "null"));
}

function unwrappedFieldTargetCanSucceed(target: StaticType): boolean {
  if (target === DYNAMIC) return true;
  if (isUnion(target)) return target.members.some(unwrappedFieldTargetCanSucceed);
  if (isShape(target)) return false;
  return isPrimitive(target, "json") || isPrimitive(target, "null");
}

function checkFunction<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function" }>,
  path: Path,
  outer: Scope,
): KaladaFunctionType {
  const parameters = new Map<string, StaticType>();
  for (const parameter of node.parameters) parameters.set(parameter.name, parameter.type);
  const actual = infer(node.body, [...path, "body"], merged(outer, parameters));
  requireAssignable(actual, node.returns, [...path, "body"]);
  return functionType(
    node.parameters.map((item) => item.type),
    node.returns,
  );
}

function checkGroup<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function-group" }>,
  path: Path,
  outer: Scope,
): StaticType {
  const signatures = new Map<string, StaticType>();
  for (const fn of node.functions) signatures.set(fn.name, signature(fn));
  const groupScope = merged(outer, signatures);
  node.functions.forEach((fn, index) => {
    checkMember(fn, [...path, "functions", index], groupScope);
  });
  return infer(node.body, [...path, "body"], groupScope);
}

function checkMember<R extends JsonValue>(fn: NamedFunction<R>, path: Path, group: Scope): void {
  const parameters = new Map<string, StaticType>();
  for (const parameter of fn.parameters) parameters.set(parameter.name, parameter.type);
  const actual = infer(fn.body, [...path, "body"], merged(group, parameters));
  requireAssignable(actual, fn.returns, [...path, "body"]);
}

function checkCall<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "call" }>,
  path: Path,
  scope: Scope,
): StaticType {
  const callee = infer(node.callee, [...path, "callee"], scope);
  const args = node.arguments.map((item, index) =>
    infer(item, [...path, "arguments", index], scope),
  );
  if (callee === DYNAMIC) return DYNAMIC;
  if (!isFunctionType(callee)) fail("KALADA_NOT_CALLABLE", [...path, "callee"]);
  if (args.length !== callee.parameters.length)
    fail("KALADA_FUNCTION_ARITY", [...path, "arguments"]);
  args.forEach((actual, index) => {
    requireAssignable(actual, callee.parameters[index] as KaladaType, [
      ...path,
      "arguments",
      index,
    ]);
  });
  return callee.returns;
}

function checkBinding<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "binding" }>,
  path: Path,
  scope: Scope,
): StaticType {
  const value = infer(node.value, [...path, "value"], scope);
  return infer(node.body, [...path, "body"], merged(scope, new Map([[node.name, value]])));
}

function checkMatch<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "match" }>,
  path: Path,
  scope: Scope,
): StaticType {
  const scrutinee = infer(node.value, [...path, "value"], scope);
  const payloads = matchPayloads(node.type, scrutinee);
  const branches = node.arms.map((arm, index) => {
    const payload = payloads.get(arm.variant) ?? DYNAMIC;
    const nested = arm.binding ? merged(scope, new Map([[arm.binding, payload]])) : scope;
    return infer(arm.body, [...path, "arms", index, "body"], nested);
  });
  return join(branches);
}

function matchPayloads(
  type: "Option" | "Result",
  value: StaticType,
): ReadonlyMap<string, StaticType> {
  if (value === DYNAMIC) return new Map();
  if (type === "Option" && isOptionShape(value)) return new Map([["some", value.value]]);
  if (type === "Option" && !isShape(value) && value.kind === "option-type")
    return new Map([["some", value.value]]);
  if (type === "Result" && isResultShape(value))
    return new Map([
      ["ok", value.ok],
      ["err", value.error],
    ]);
  if (type === "Result" && !isShape(value) && value.kind === "result-type")
    return new Map([
      ["ok", value.ok],
      ["err", value.error],
    ]);
  return new Map();
}

function inferTemporal<R extends JsonValue>(
  node: Extract<
    KaladaV1Expression<R>,
    {
      kind:
        | "instant"
        | "duration"
        | "current-instant"
        | "temporal-arithmetic"
        | "temporal-comparison";
    }
  >,
  path: Path,
  scope: Scope,
): StaticType {
  if (node.kind === "instant" || node.kind === "current-instant") return primitive("Instant");
  if (node.kind === "duration") return primitive("Duration");
  const left = infer(node.left, [...path, "left"], scope);
  const right = infer(node.right, [...path, "right"], scope);
  if (node.kind === "temporal-comparison") return primitive("boolean");
  return temporalArithmetic(node.operator, left, right);
}

function temporalArithmetic(
  operator: "add" | "subtract",
  left: StaticType,
  right: StaticType,
): StaticType {
  if (operator === "add") return additionType(left, right);
  if (isPrimitive(left, "Duration")) return primitive("Duration");
  if (isPrimitive(right, "Instant")) return primitive("Duration");
  if (isPrimitive(left, "Instant") && isPrimitive(right, "Duration")) return primitive("Instant");
  return union([primitive("Instant"), primitive("Duration")]);
}

function additionType(left: StaticType, _right: StaticType): StaticType {
  if (isPrimitive(left, "Instant")) return primitive("Instant");
  if (isPrimitive(left, "Duration")) return primitive("Duration");
  return union([primitive("Instant"), primitive("Duration")]);
}

function optionType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "option" }>,
  path: Path,
  scope: Scope,
): OptionShape {
  return Object.freeze({
    shape: "option",
    value: node.variant === "none" ? DYNAMIC : infer(node.value, [...path, "value"], scope),
  });
}

function resultType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "result" }>,
  path: Path,
  scope: Scope,
): ResultShape {
  const value = infer(node.value, [...path, "value"], scope);
  return Object.freeze({
    shape: "result",
    ok: node.variant === "ok" ? value : DYNAMIC,
    error: node.variant === "err" ? value : DYNAMIC,
  });
}

function requireAssignable(actual: StaticType, expected: KaladaType, path: Path): void {
  if (!assignable(actual, expected)) fail("KALADA_FUNCTION_TYPE_MISMATCH", path);
}

function assignable(actual: StaticType, expected: KaladaType): boolean {
  if (actual === DYNAMIC) return true;
  if (isUnion(actual)) return actual.members.every((member) => assignable(member, expected));
  if (isOptionShape(actual))
    return expected.kind === "option-type" && assignable(actual.value, expected.value);
  if (isResultShape(actual))
    return (
      expected.kind === "result-type" &&
      assignable(actual.ok, expected.ok) &&
      assignable(actual.error, expected.error)
    );
  if (expected.kind === "primitive-type" && expected.name === "json" && !isShape(actual)) {
    return isJsonType(actual);
  }
  return equalType(actual, expected);
}

function isJsonType(type: KaladaType): boolean {
  if (type.kind === "array-type") return isJsonType(type.element);
  if (type.kind !== "primitive-type") return false;
  return ["null", "boolean", "number", "string", "json"].includes(type.name);
}

function join(types: readonly StaticType[]): StaticType {
  const unique: StaticType[] = [];
  for (const item of types) {
    if (!unique.some((candidate) => staticEqual(candidate, item))) unique.push(item);
  }
  return unique.length === 1 ? (unique[0] as StaticType) : union(unique);
}

function coreType(name: "map" | "filter" | "some" | "every"): KaladaFunctionType {
  const callback = functionType(
    [primitive("json"), primitive("number")],
    primitive(name === "map" ? "json" : "boolean"),
  );
  const array = Object.freeze({ kind: "array-type", element: primitive("json") }) as KaladaType;
  return functionType(
    [array, callback],
    name === "some" || name === "every" ? primitive("boolean") : array,
  );
}

function signature<R extends JsonValue>(fn: NamedFunction<R>): KaladaFunctionType {
  return functionType(
    fn.parameters.map((item) => item.type),
    fn.returns,
  );
}

function functionType(parameters: readonly KaladaType[], returns: KaladaType): KaladaFunctionType {
  return Object.freeze({
    kind: "function-type",
    parameters: Object.freeze([...parameters]),
    returns,
  });
}

function fail(code: ConstructorParameters<typeof KaladaFailure>[0], path: Path): never {
  throw new KaladaFailure(code, path);
}

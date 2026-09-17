import type { JsonValue } from "./json.js";
import { isDuration, isInstant } from "./temporal.js";
import type {
  KaladaCoreFunctionName,
  KaladaFunctionParameter,
  KaladaFunctionType,
  KaladaType,
  KaladaV1Expression,
  NamedFunction,
} from "./types.js";
import { isOption, isResult, type KaladaValue } from "./values.js";

export type RuntimeEnvironment = ReadonlyMap<string, RuntimeValue>;
export type RuntimeValue = KaladaValue | UserClosure<JsonValue> | CoreCallable;

export interface RecursiveEnvironment<R extends JsonValue> {
  readonly names: readonly string[];
  readonly closures: readonly UserClosure<R>[];
}

export interface UserClosure<R extends JsonValue> {
  readonly callable: "user";
  readonly name: string | null;
  readonly path: readonly (string | number)[];
  readonly parameters: readonly KaladaFunctionParameter[];
  readonly returns: KaladaType;
  readonly body: KaladaV1Expression<R>;
  readonly captures: RuntimeEnvironment;
  readonly recursive: RecursiveEnvironment<R> | null;
}

export interface CoreCallable {
  readonly callable: "core";
  readonly name: KaladaCoreFunctionName;
}

const callables = new WeakSet<object>();

export function isCallable(value: RuntimeValue): value is UserClosure<JsonValue> | CoreCallable {
  return typeof value === "object" && value !== null && callables.has(value);
}

export function coreCallable(name: KaladaCoreFunctionName): CoreCallable {
  return branded({ callable: "core", name });
}

export function callableType(value: UserClosure<JsonValue> | CoreCallable): KaladaFunctionType {
  if (value.callable === "user") {
    return Object.freeze({
      kind: "function-type",
      parameters: Object.freeze(value.parameters.map((item) => item.type)),
      returns: value.returns,
    });
  }
  const json = primitive("json");
  const callback = functionType(
    [json, primitive("number")],
    primitive(value.name === "map" ? "json" : "boolean"),
  );
  const array = Object.freeze({ kind: "array-type", element: json }) as KaladaType;
  return functionType(
    [array, callback],
    value.name === "some" || value.name === "every" ? primitive("boolean") : array,
  );
}

export function matchesType(value: RuntimeValue, expected: KaladaType): boolean {
  if (expected.kind === "function-type") {
    return isCallable(value) && equalType(callableType(value), expected);
  }
  if (isCallable(value)) return false;
  if (expected.kind === "primitive-type") return matchesPrimitive(value, expected.name);
  if (expected.kind === "option-type") {
    return (
      isOption(value) && (value.variant === "none" || matchesType(value.value, expected.value))
    );
  }
  if (expected.kind === "result-type") {
    return (
      isResult(value) &&
      matchesType(value.value, value.variant === "ok" ? expected.ok : expected.error)
    );
  }
  return Array.isArray(value) && value.every((item) => matchesType(item, expected.element));
}

export function closureFromExpression<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function" }>,
  path: readonly (string | number)[],
  captures: RuntimeEnvironment,
): UserClosure<R> {
  return branded({
    callable: "user",
    name: null,
    path,
    parameters: node.parameters,
    returns: node.returns,
    body: node.body,
    captures,
    recursive: null,
  });
}

export function closureFromMember<R extends JsonValue>(
  node: NamedFunction<R>,
  path: readonly (string | number)[],
  captures: RuntimeEnvironment,
  recursive: RecursiveEnvironment<R>,
): UserClosure<R> {
  return branded({
    callable: "user",
    name: node.name,
    path,
    parameters: node.parameters,
    returns: node.returns,
    body: node.body,
    captures,
    recursive,
  });
}

function branded<T extends object>(value: T): T {
  Object.freeze(value);
  callables.add(value);
  return value;
}

function matchesPrimitive(value: KaladaValue, name: string): boolean {
  if (name === "json")
    return !isOption(value) && !isResult(value) && !isInstant(value) && !isDuration(value);
  if (name === "Instant") return isInstant(value);
  if (name === "Duration") return isDuration(value);
  if (name === "null") return value === null;
  return typeof value === name;
}

function equalType(left: KaladaType, right: KaladaType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "primitive-type" && right.kind === "primitive-type")
    return left.name === right.name;
  if (left.kind === "option-type" && right.kind === "option-type")
    return equalType(left.value, right.value);
  if (left.kind === "array-type" && right.kind === "array-type")
    return equalType(left.element, right.element);
  if (left.kind === "result-type" && right.kind === "result-type")
    return equalType(left.ok, right.ok) && equalType(left.error, right.error);
  if (left.kind !== "function-type" || right.kind !== "function-type") return false;
  return (
    left.parameters.length === right.parameters.length &&
    left.parameters.every((item, index) =>
      equalType(item, right.parameters[index] as KaladaType),
    ) &&
    equalType(left.returns, right.returns)
  );
}

function primitive(name: "number" | "boolean" | "json"): KaladaType {
  return Object.freeze({ kind: "primitive-type", name });
}

function functionType(parameters: readonly KaladaType[], returns: KaladaType): KaladaFunctionType {
  return Object.freeze({ kind: "function-type", parameters: Object.freeze(parameters), returns });
}

import {
  bindingName,
  type CanonicalState,
  count,
  exact,
  type Path,
  properties,
  strictArray,
} from "./canonical-input.js";
import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import type {
  CallExpression,
  CoreFunctionExpression,
  FunctionExpression,
  FunctionGroupExpression,
  KaladaFunctionParameter,
  KaladaType,
  KaladaV1Expression,
  NamedFunction,
} from "./types.js";

type NodeReader<R extends JsonValue> = (
  input: unknown,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
) => KaladaV1Expression<R>;

const TYPE_KEYS = new Set([
  "kind",
  "name",
  "value",
  "ok",
  "error",
  "element",
  "parameters",
  "returns",
]);
const PRIMITIVES = new Set(["null", "boolean", "number", "string", "json", "Instant", "Duration"]);

export function canonicalFunction<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  read: NodeReader<R>,
): FunctionExpression<R> {
  exact(raw, path, ["kind", "parameters", "returns", "body"]);
  const parameters = canonicalParameters(raw.parameters, [...path, "parameters"], depth + 1, state);
  const returns = canonicalType(raw.returns, [...path, "returns"], depth + 1, state);
  const body = read(raw.body, [...path, "body"], depth + 1, state);
  return Object.freeze({ kind: "function", parameters, returns, body });
}

export function canonicalCall<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  read: NodeReader<R>,
): CallExpression<R> {
  exact(raw, path, ["kind", "callee", "arguments"]);
  const callee = read(raw.callee, [...path, "callee"], depth + 1, state);
  const args = array(raw.arguments, [...path, "arguments"]);
  const output = args.map((item, index) =>
    read(item, [...path, "arguments", index], depth + 1, state),
  );
  return Object.freeze({ kind: "call", callee, arguments: Object.freeze(output) });
}

export function canonicalGroup<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  read: NodeReader<R>,
): FunctionGroupExpression<R> {
  exact(raw, path, ["kind", "functions", "body"]);
  const entries = array(raw.functions, [...path, "functions"]);
  if (entries.length > state.limits.maxFunctionGroupSize) limit([...path, "functions"]);
  const names = new Set<string>();
  const functions = entries.map((item, index) => {
    const member = canonicalMember(item, [...path, "functions", index], depth + 1, state, read);
    if (names.has(member.name)) duplicate([...path, "functions", index, "name"]);
    names.add(member.name);
    return member;
  });
  const body = read(raw.body, [...path, "body"], depth + 1, state);
  return Object.freeze({ kind: "function-group", functions: Object.freeze(functions), body });
}

export function canonicalCoreFunction(
  raw: Record<string, unknown>,
  path: Path,
): CoreFunctionExpression {
  exact(raw, path, ["kind", "name"]);
  if (raw.name !== "map" && raw.name !== "filter" && raw.name !== "some" && raw.name !== "every") {
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "name"]);
  }
  return Object.freeze({ kind: "core-function", name: raw.name });
}

export function canonicalType<R extends JsonValue>(
  input: unknown,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
): KaladaType {
  count(path, depth, state);
  if (typeof input !== "object" || input === null || state.active.has(input)) {
    throw new KaladaFailure("KALADA_INVALID_FUNCTION_TYPE", path);
  }
  state.active.add(input);
  try {
    const raw = properties(input, path, TYPE_KEYS, false);
    if (raw.kind === "primitive-type") return primitiveType(raw, path);
    if (raw.kind === "option-type")
      return unaryType(raw, path, depth, state, "option-type", "value");
    if (raw.kind === "array-type")
      return unaryType(raw, path, depth, state, "array-type", "element");
    if (raw.kind === "result-type") return resultType(raw, path, depth, state);
    if (raw.kind === "function-type") return functionType(raw, path, depth, state);
    throw new KaladaFailure("KALADA_INVALID_FUNCTION_TYPE", [...path, "kind"]);
  } finally {
    state.active.delete(input);
  }
}

function canonicalMember<R extends JsonValue>(
  input: unknown,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  read: NodeReader<R>,
): NamedFunction<R> {
  count(path, depth, state);
  const raw = properties(input, path, new Set(["name", "parameters", "returns", "body"]));
  const name = bindingName(raw.name, [...path, "name"], state.limits);
  const parameters = canonicalParameters(raw.parameters, [...path, "parameters"], depth + 1, state);
  const returns = canonicalType(raw.returns, [...path, "returns"], depth + 1, state);
  const body = read(raw.body, [...path, "body"], depth + 1, state);
  return Object.freeze({ name, parameters, returns, body });
}

function canonicalParameters<R extends JsonValue>(
  input: unknown,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
): readonly KaladaFunctionParameter[] {
  const entries = array(input, path);
  if (entries.length > state.limits.maxFunctionParameters) limit(path);
  const names = new Set<string>();
  const output = entries.map((item, index) => {
    const itemPath = [...path, index];
    count(itemPath, depth, state);
    const raw = properties(item, itemPath, new Set(["name", "type"]));
    const name = bindingName(raw.name, [...itemPath, "name"], state.limits);
    if (names.has(name)) duplicate([...itemPath, "name"]);
    names.add(name);
    return Object.freeze({
      name,
      type: canonicalType(raw.type, [...itemPath, "type"], depth + 1, state),
    });
  });
  return Object.freeze(output);
}

function functionType<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
): KaladaType {
  exact(raw, path, ["kind", "parameters", "returns"]);
  const entries = array(raw.parameters, [...path, "parameters"]);
  if (entries.length > state.limits.maxFunctionParameters) limit([...path, "parameters"]);
  const parameters = entries.map((item, index) =>
    canonicalType(item, [...path, "parameters", index], depth + 1, state),
  );
  const returns = canonicalType(raw.returns, [...path, "returns"], depth + 1, state);
  return Object.freeze({ kind: "function-type", parameters: Object.freeze(parameters), returns });
}

function primitiveType(raw: Record<string, unknown>, path: Path): KaladaType {
  exact(raw, path, ["kind", "name"]);
  if (typeof raw.name !== "string" || !PRIMITIVES.has(raw.name)) {
    throw new KaladaFailure("KALADA_INVALID_FUNCTION_TYPE", [...path, "name"]);
  }
  return Object.freeze({ kind: "primitive-type", name: raw.name }) as KaladaType;
}

function unaryType<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  kind: "option-type" | "array-type",
  key: "value" | "element",
): KaladaType {
  exact(raw, path, ["kind", key]);
  return Object.freeze({
    kind,
    [key]: canonicalType(raw[key], [...path, key], depth + 1, state),
  }) as KaladaType;
}

function resultType<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
): KaladaType {
  exact(raw, path, ["kind", "ok", "error"]);
  return Object.freeze({
    kind: "result-type",
    ok: canonicalType(raw.ok, [...path, "ok"], depth + 1, state),
    error: canonicalType(raw.error, [...path, "error"], depth + 1, state),
  });
}

function array(input: unknown, path: Path): unknown[] {
  if (!Array.isArray(input)) throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  return strictArray(input, path);
}

function limit(path: Path): never {
  throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
}
function duplicate(path: Path): never {
  throw new KaladaFailure("KALADA_DUPLICATE_BINDING", path);
}

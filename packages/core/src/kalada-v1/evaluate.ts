import { rejectCallbackPromise } from "../kuery-v1/callback-promise.js";
import { failure, KaladaFailure, success } from "./diagnostics.js";
import { cloneJson, dataValue, type JsonValue } from "./json.js";
import type {
  KaladaV1Expression,
  KaladaV1Limits,
  KaladaV1Outcome,
  KaladaV1Resolver,
  MatchArm,
} from "./types.js";
import { isOption, isResult, type KaladaValue, Option, Result } from "./values.js";

type Path = readonly (string | number)[];
interface State<R extends JsonValue> {
  readonly resolve: KaladaV1Resolver<R>;
  readonly limits: KaladaV1Limits;
  steps: number;
}

export function evaluateKaladaV1<R extends JsonValue>(
  expression: KaladaV1Expression<R>,
  resolve: KaladaV1Resolver<R>,
  limits: KaladaV1Limits,
): KaladaV1Outcome<KaladaValue> {
  try {
    return success(
      evaluateNode(expression, ["expression"], new Map(), { resolve, limits, steps: 0 }),
    );
  } catch (error) {
    const problem =
      error instanceof KaladaFailure ? error : new KaladaFailure("KALADA_REFERENCE_ERROR", []);
    return failure(problem.code, problem.path);
  }
}

function evaluateNode<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: ReadonlyMap<string, KaladaValue>,
  state: State<R>,
): KaladaValue {
  charge(path, state);
  if (node.kind === "literal") return node.value;
  if (node.kind === "ref") return evaluateReference(node.ref, path, scope, state);
  if (node.kind === "binding") return evaluateBinding(node, path, scope, state);
  if (node.kind === "option") {
    return node.variant === "none"
      ? Option.none()
      : Option.some(evaluateNode(node.value, [...path, "value"], scope, state));
  }
  if (node.kind === "result") {
    const value = evaluateNode(node.value, [...path, "value"], scope, state);
    return node.variant === "ok" ? Result.ok(value) : Result.err(value);
  }
  return evaluateMatch(node, path, scope, state);
}

function evaluateBinding<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "binding" }>,
  path: Path,
  scope: ReadonlyMap<string, KaladaValue>,
  state: State<R>,
): KaladaValue {
  const value = evaluateNode(node.value, [...path, "value"], scope, state);
  const nested = new Map(scope);
  nested.set(node.name, value);
  return evaluateNode(node.body, [...path, "body"], nested, state);
}

function evaluateMatch<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "match" }>,
  path: Path,
  scope: ReadonlyMap<string, KaladaValue>,
  state: State<R>,
): KaladaValue {
  const valuePath = [...path, "value"];
  const value = evaluateNode(node.value, valuePath, scope, state);
  if (node.type === "Option" && !isOption(value)) {
    throw new KaladaFailure("KALADA_MATCH_TYPE_MISMATCH", valuePath);
  }
  if (node.type === "Result" && !isResult(value)) {
    throw new KaladaFailure("KALADA_MATCH_TYPE_MISMATCH", valuePath);
  }
  if (!isOption(value) && !isResult(value)) {
    throw new KaladaFailure("KALADA_MATCH_TYPE_MISMATCH", valuePath);
  }
  const variant = value.variant;
  const armIndex = node.arms.findIndex((candidate) => candidate.variant === variant);
  const arm = node.arms[armIndex];
  if (!arm) throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "arms"]);
  const nested = bindPayload(scope, arm, value);
  return evaluateNode(arm.body, [...path, "arms", armIndex, "body"], nested, state);
}

function bindPayload(
  scope: ReadonlyMap<string, KaladaValue>,
  arm: MatchArm<JsonValue>,
  value: KaladaValue,
): ReadonlyMap<string, KaladaValue> {
  if (!arm.binding || (!isOption(value) && !isResult(value)) || value.variant === "none")
    return scope;
  const nested = new Map(scope);
  nested.set(arm.binding, value.value);
  return nested;
}

function evaluateReference<R extends JsonValue>(
  reference: R,
  path: Path,
  scope: ReadonlyMap<string, KaladaValue>,
  state: State<R>,
): KaladaValue {
  if (typeof reference === "string" && scope.has(reference))
    return scope.get(reference) as KaladaValue;
  let input: unknown;
  try {
    input = state.resolve(reference);
  } catch {
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  }
  if (rejectCallbackPromise(input)) throw new KaladaFailure("KALADA_ASYNC_UNSUPPORTED", path);
  return parseResolution(input, path, state.limits);
}

function parseResolution(input: unknown, path: Path, limits: KaladaV1Limits): KaladaValue {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  }
  const keys = safeKeys(input, path);
  const found = safeData(input, "found", path);
  if (typeof found !== "boolean") throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  if (!found) return missingResolution(input, keys, path);
  if (keys.length !== 2 || !keys.includes("value"))
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  return safeValue(safeData(input, "value", path), path, limits);
}

function missingResolution(input: object, keys: readonly PropertyKey[], path: Path): never {
  if (keys.length === 1) throw new KaladaFailure("KALADA_REFERENCE_MISSING", path);
  if (keys.length !== 2 || !keys.includes("reason"))
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  const reason = safeData(input, "reason", path);
  if (reason === undefined || reason === "missing")
    throw new KaladaFailure("KALADA_REFERENCE_MISSING", path);
  if (reason === "denied") throw new KaladaFailure("KALADA_REFERENCE_DENIED", path);
  throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
}

function safeValue(input: unknown, path: Path, limits: KaladaV1Limits): KaladaValue {
  if (isOption(input) || isResult(input)) return input;
  try {
    return cloneJson(input, limits);
  } catch (error) {
    if (error instanceof RangeError) throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
    throw new KaladaFailure("KALADA_INVALID_RESULT", path);
  }
}

function safeKeys(input: object, path: Path): PropertyKey[] {
  try {
    return Reflect.ownKeys(input);
  } catch {
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  }
}

function safeData(input: object, key: string, path: Path): unknown {
  try {
    return dataValue(input, key);
  } catch {
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  }
}

function charge<R extends JsonValue>(path: Path, state: State<R>): void {
  state.steps += 1;
  if (state.steps > state.limits.maxEvaluationSteps) {
    throw new KaladaFailure("KALADA_EVALUATION_LIMIT", path);
  }
}

import { failure, KaladaFailure, success } from "./diagnostics.js";
import {
  canonicalJsonIdentity,
  cloneJson,
  cloneJsonWithStats,
  dataValue,
  type JsonValue,
} from "./json.js";
import { resolveLimits } from "./limits.js";
import type {
  KaladaV1Expression,
  KaladaV1Limits,
  KaladaV1Options,
  KaladaV1Outcome,
  KaladaV1Program,
  MatchArm,
} from "./types.js";

type Path = readonly (string | number)[];
interface State<R extends JsonValue> {
  readonly limits: KaladaV1Limits;
  readonly options: KaladaV1Options<R>;
  readonly active: WeakSet<object>;
  astNodes: number;
  valueNodes: number;
}

const NODE_KEYS = new Set(["kind", "value", "ref", "name", "body", "variant", "type", "arms"]);
const ARM_ORDER = Object.freeze({ Option: ["some", "none"], Result: ["ok", "err"] } as const);

export function canonicalizeKaladaV1Program<R extends JsonValue = string>(
  input: unknown,
  options: KaladaV1Options<R> = {},
): KaladaV1Outcome<KaladaV1Program<R>> {
  try {
    const limits = resolveLimits(options.limits);
    const fields = properties(input, [], new Set(["format", "version", "profile", "expression"]));
    if (
      fields.format !== "kalada-program" ||
      fields.version !== 1 ||
      fields.profile !== "kalada-v1"
    ) {
      throw new KaladaFailure("KALADA_INVALID_INPUT", []);
    }
    const state: State<R> = {
      limits,
      options,
      active: new WeakSet(),
      astNodes: 0,
      valueNodes: 0,
    };
    const expression = canonicalNode(fields.expression, ["expression"], 0, state);
    return success(
      Object.freeze({ format: "kalada-program", version: 1, profile: "kalada-v1", expression }),
    );
  } catch (error) {
    const problem =
      error instanceof KaladaFailure ? error : new KaladaFailure("KALADA_INVALID_INPUT", []);
    return failure(problem.code, problem.path);
  }
}

function canonicalNode<R extends JsonValue>(
  input: unknown,
  path: Path,
  depth: number,
  state: State<R>,
): KaladaV1Expression<R> {
  count(path, depth, state);
  if (typeof input !== "object" || input === null || state.active.has(input)) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  state.active.add(input);
  try {
    const raw = properties(input, path, NODE_KEYS, false);
    if (raw.kind === "literal") return canonicalLiteral(raw, path, state);
    if (raw.kind === "ref") return canonicalReference(raw, path, state);
    if (raw.kind === "binding") return canonicalBinding(raw, path, depth, state);
    if (raw.kind === "option") return canonicalOption(raw, path, depth, state);
    if (raw.kind === "result") return canonicalResult(raw, path, depth, state);
    if (raw.kind === "match") return canonicalMatch(raw, path, depth, state);
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "kind"]);
  } finally {
    state.active.delete(input);
  }
}

function canonicalLiteral<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  state: State<R>,
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "value"]);
  return Object.freeze({
    kind: "literal",
    value: safeJson(raw.value, [...path, "value"], state),
  });
}

function canonicalReference<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  state: State<R>,
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "ref"]);
  const refPath = [...path, "ref"];
  const codec = state.options.reference;
  const ref = (
    codec ? inspectJson(raw.ref, refPath, state) : safeJson(raw.ref, refPath, state)
  ) as R;
  if (codec ? !safeValidate(codec.validate, ref) : typeof ref !== "string" || ref.length === 0) {
    throw new KaladaFailure("KALADA_INVALID_REFERENCE", refPath);
  }
  const replacement = codec?.canonicalize
    ? safeCanonicalize(codec.canonicalize, ref, refPath)
    : ref;
  const output = (codec ? safeJson(replacement, refPath, state) : replacement) as R;
  if (codec && !safeValidate(codec.validate, output))
    throw new KaladaFailure("KALADA_INVALID_REFERENCE", refPath);
  if (referenceLength(output) > state.limits.maxReferenceLength)
    throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", refPath);
  return Object.freeze({ kind: "ref", ref: output });
}

function canonicalBinding<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: State<R>,
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "name", "value", "body"]);
  const name = bindingName(raw.name, [...path, "name"], state.limits);
  return Object.freeze({
    kind: "binding",
    name,
    value: canonicalNode(raw.value, [...path, "value"], depth + 1, state),
    body: canonicalNode(raw.body, [...path, "body"], depth + 1, state),
  });
}

function canonicalOption<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: State<R>,
): KaladaV1Expression<R> {
  if (raw.variant === "none") {
    exact(raw, path, ["kind", "variant"]);
    return Object.freeze({ kind: "option", variant: "none" });
  }
  if (raw.variant !== "some") throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "variant"]);
  exact(raw, path, ["kind", "variant", "value"]);
  return Object.freeze({
    kind: "option",
    variant: "some",
    value: canonicalNode(raw.value, [...path, "value"], depth + 1, state),
  });
}

function canonicalResult<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: State<R>,
): KaladaV1Expression<R> {
  if (raw.variant !== "ok" && raw.variant !== "err")
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "variant"]);
  exact(raw, path, ["kind", "variant", "value"]);
  return Object.freeze({
    kind: "result",
    variant: raw.variant,
    value: canonicalNode(raw.value, [...path, "value"], depth + 1, state),
  });
}

function canonicalMatch<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: State<R>,
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "type", "value", "arms"]);
  if (raw.type !== "Option" && raw.type !== "Result")
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "type"]);
  const value = canonicalNode(raw.value, [...path, "value"], depth + 1, state);
  const arms = canonicalArms(raw.arms, raw.type, path, depth, state);
  return Object.freeze({ kind: "match", type: raw.type, value, arms });
}

function canonicalArms<R extends JsonValue>(
  input: unknown,
  type: "Option" | "Result",
  path: Path,
  depth: number,
  state: State<R>,
): readonly MatchArm<R>[] {
  if (!Array.isArray(input)) throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "arms"]);
  const entries = strictArray(input, [...path, "arms"]);
  const expected: readonly string[] = ARM_ORDER[type];
  const found = new Map<string, MatchArm<R>>();
  entries.forEach((entry, index) => {
    addArm(entry, index, type, expected, found, path, depth, state);
  });
  if (found.size !== expected.length)
    throw new KaladaFailure("KALADA_MATCH_MISSING_ARM", [...path, "arms"]);
  return Object.freeze(expected.map((variant) => requiredArm(found, variant, path)));
}

function addArm<R extends JsonValue>(
  input: unknown,
  index: number,
  type: "Option" | "Result",
  expected: readonly string[],
  found: Map<string, MatchArm<R>>,
  path: Path,
  depth: number,
  state: State<R>,
): void {
  const armPath = [...path, "arms", index];
  const raw = properties(input, armPath, new Set(["variant", "binding", "body"]), false);
  if (found.size === expected.length)
    throw new KaladaFailure("KALADA_MATCH_UNREACHABLE_ARM", armPath);
  if (typeof raw.variant !== "string" || !expected.includes(raw.variant))
    throw new KaladaFailure("KALADA_MATCH_UNKNOWN_ARM", [...armPath, "variant"]);
  if (found.has(raw.variant))
    throw new KaladaFailure("KALADA_MATCH_DUPLICATE_ARM", [...armPath, "variant"]);
  const allowsBinding = raw.variant !== "none";
  if (!allowsBinding && "binding" in raw)
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...armPath, "binding"]);
  exact(
    raw,
    armPath,
    allowsBinding ? ["variant", "body", "binding"] : ["variant", "body"],
    allowsBinding,
  );
  const binding =
    raw.binding === undefined
      ? undefined
      : bindingName(raw.binding, [...armPath, "binding"], state.limits);
  const body = canonicalNode(raw.body, [...armPath, "body"], depth + 1, state);
  found.set(
    raw.variant,
    Object.freeze({ variant: raw.variant, ...(binding ? { binding } : {}), body }) as MatchArm<R>,
  );
  void type;
}

function requiredArm<R extends JsonValue>(
  found: Map<string, MatchArm<R>>,
  variant: string,
  path: Path,
): MatchArm<R> {
  const arm = found.get(variant);
  if (!arm) throw new KaladaFailure("KALADA_MATCH_MISSING_ARM", [...path, "arms"]);
  return arm;
}

function properties(
  input: unknown,
  path: Path,
  allowed: ReadonlySet<string>,
  requireExact = true,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key))
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, String(key)]);
    try {
      output[key] = dataValue(input, key);
    } catch {
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, key]);
    }
  }
  if (requireExact && keys.length !== allowed.size)
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  return output;
}

function exact(
  raw: Record<string, unknown>,
  path: Path,
  keys: readonly string[],
  optionalLast = false,
): void {
  const minimum = optionalLast ? keys.length - 1 : keys.length;
  if (Object.keys(raw).length < minimum || Object.keys(raw).length > keys.length)
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  for (let index = 0; index < minimum; index += 1) {
    const key = keys[index];
    if (key !== undefined && !(key in raw))
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, key]);
  }
  for (const key of Object.keys(raw))
    if (!keys.includes(key)) throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, key]);
}

function strictArray(input: unknown[], path: Path): unknown[] {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
  if (keys.length !== input.length + 1) throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  return Array.from({ length: input.length }, (_, index) => {
    try {
      return dataValue(input, String(index));
    } catch {
      throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, index]);
    }
  });
}

function safeJson<R extends JsonValue>(input: unknown, path: Path, state: State<R>): JsonValue {
  try {
    const result = cloneJsonWithStats(input, {
      maxDepth: state.limits.maxValueDepth,
      maxNodes: state.limits.maxValueNodes - state.valueNodes,
      maxStringLength: state.limits.maxStringLength,
    });
    state.valueNodes += result.nodes;
    return result.value;
  } catch (error) {
    if (error instanceof RangeError) throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
}

function inspectJson<R extends JsonValue>(input: unknown, path: Path, state: State<R>): JsonValue {
  try {
    return cloneJson(input, {
      maxDepth: state.limits.maxValueDepth,
      maxNodes: state.limits.maxValueNodes,
      maxStringLength: state.limits.maxStringLength,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  }
}

function referenceLength(reference: JsonValue): number {
  return typeof reference === "string"
    ? [...reference].length
    : [...canonicalJsonIdentity(reference)].length;
}

function bindingName(input: unknown, path: Path, limits: KaladaV1Limits): string {
  if (typeof input !== "string" || input.length === 0)
    throw new KaladaFailure("KALADA_INVALID_INPUT", path);
  if ([...input].length > limits.maxReferenceLength)
    throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
  return input;
}

function safeValidate<R>(validate: (input: unknown) => input is R, input: unknown): input is R {
  try {
    return validate(input) === true;
  } catch {
    return false;
  }
}

function safeCanonicalize<R>(canonicalize: (input: R) => R, input: R, path: Path): R {
  try {
    return canonicalize(input);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_REFERENCE", path);
  }
}

function count<R extends JsonValue>(path: Path, depth: number, state: State<R>): void {
  state.astNodes += 1;
  if (depth > state.limits.maxAstDepth || state.astNodes > state.limits.maxAstNodes)
    throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
}

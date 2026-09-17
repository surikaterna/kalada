import {
  bindingName,
  count,
  exact,
  inspectJson,
  type Path,
  properties,
  referenceLength,
  type CanonicalState as State,
  safeCanonicalize,
  safeJson,
  safeValidate,
  strictArray,
} from "./canonical-input.js";
import { failure, KaladaFailure, success } from "./diagnostics.js";
import {
  canonicalCall,
  canonicalCoreFunction,
  canonicalFunction,
  canonicalGroup,
} from "./function-contracts.js";
import type { JsonValue } from "./json.js";
import { resolveLimits } from "./limits.js";
import type {
  KaladaV1Expression,
  KaladaV1Options,
  KaladaV1Outcome,
  KaladaV1Program,
  MatchArm,
} from "./types.js";

const NODE_KEYS = new Set([
  "kind",
  "value",
  "ref",
  "name",
  "body",
  "variant",
  "type",
  "arms",
  "milliseconds",
  "operator",
  "left",
  "right",
  "parameters",
  "returns",
  "callee",
  "arguments",
  "functions",
]);
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
    const added = canonicalAddedNode(raw, path, depth, state);
    if (added) return added;
    if (raw.kind === "binding") return canonicalBinding(raw, path, depth, state);
    if (raw.kind === "option") return canonicalOption(raw, path, depth, state);
    if (raw.kind === "result") return canonicalResult(raw, path, depth, state);
    if (raw.kind === "match") return canonicalMatch(raw, path, depth, state);
    if (raw.kind === "instant" || raw.kind === "duration") return canonicalTemporal(raw, path);
    if (raw.kind === "current-instant") return canonicalCurrentInstant(raw, path);
    if (raw.kind === "temporal-arithmetic") {
      return canonicalTemporalOperation(raw, path, depth, state, ["add", "subtract"]);
    }
    if (raw.kind === "temporal-comparison") {
      return canonicalTemporalOperation(raw, path, depth, state, [
        "equal",
        "not-equal",
        "less-than",
        "less-than-or-equal",
        "greater-than",
        "greater-than-or-equal",
      ]);
    }
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "kind"]);
  } finally {
    state.active.delete(input);
  }
}

function canonicalAddedNode<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: State<R>,
): KaladaV1Expression<R> | undefined {
  if (raw.kind === "function") return canonicalFunction(raw, path, depth, state, canonicalNode);
  if (raw.kind === "call") return canonicalCall(raw, path, depth, state, canonicalNode);
  if (raw.kind === "function-group") return canonicalGroup(raw, path, depth, state, canonicalNode);
  if (raw.kind === "core-function") return canonicalCoreFunction(raw, path);
  return undefined;
}

function canonicalTemporal(
  raw: Record<string, unknown>,
  path: Path,
): Extract<KaladaV1Expression, { kind: "instant" | "duration" }> {
  exact(raw, path, ["kind", "milliseconds"]);
  if (!Number.isSafeInteger(raw.milliseconds)) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "milliseconds"]);
  }
  return Object.freeze({
    kind: raw.kind,
    milliseconds: Object.is(raw.milliseconds, -0) ? 0 : raw.milliseconds,
  }) as Extract<KaladaV1Expression, { kind: "instant" | "duration" }>;
}

function canonicalCurrentInstant(
  raw: Record<string, unknown>,
  path: Path,
): Extract<KaladaV1Expression, { kind: "current-instant" }> {
  exact(raw, path, ["kind"]);
  return Object.freeze({ kind: "current-instant" });
}

function canonicalTemporalOperation<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: State<R>,
  operators: readonly string[],
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "operator", "left", "right"]);
  if (typeof raw.operator !== "string" || !operators.includes(raw.operator)) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "operator"]);
  }
  return Object.freeze({
    kind: raw.kind,
    operator: raw.operator,
    left: canonicalNode(raw.left, [...path, "left"], depth + 1, state),
    right: canonicalNode(raw.right, [...path, "right"], depth + 1, state),
  }) as KaladaV1Expression<R>;
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

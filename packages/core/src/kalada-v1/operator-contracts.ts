import { type CanonicalState, exact, type Path } from "./canonical-input.js";
import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import type { KaladaV1Expression } from "./types.js";

type CanonicalNode<R extends JsonValue> = (
  input: unknown,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
) => KaladaV1Expression<R>;

export function canonicalOperatorNode<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  canonicalNode: CanonicalNode<R>,
): KaladaV1Expression<R> | undefined {
  if (raw.kind === "equality") {
    return canonicalBinary(raw, path, depth, state, canonicalNode, ["equal", "not-equal"]);
  }
  if (raw.kind === "ordered-comparison") {
    return canonicalOrdered(raw, path, depth, state, canonicalNode);
  }
  if (raw.kind === "membership") {
    exact(raw, path, ["kind", "needle", "array"]);
    return Object.freeze({
      kind: "membership",
      needle: canonicalNode(raw.needle, [...path, "needle"], depth + 1, state),
      array: canonicalNode(raw.array, [...path, "array"], depth + 1, state),
    });
  }
  if (raw.kind === "numeric-binary") {
    return canonicalBinary(raw, path, depth, state, canonicalNode, [
      "add",
      "subtract",
      "multiply",
      "divide",
      "remainder",
    ]);
  }
  if (raw.kind === "numeric-unary") {
    return canonicalUnary(raw, path, depth, state, canonicalNode, ["plus", "negate"]);
  }
  if (raw.kind === "boolean-not") {
    return canonicalOperand(raw, path, depth, state, canonicalNode);
  }
  if (raw.kind === "boolean-logical") {
    return canonicalBinary(raw, path, depth, state, canonicalNode, ["and", "or"]);
  }
  if (raw.kind === "boolean-xor") {
    exact(raw, path, ["kind", "left", "right"]);
    return canonicalPair(raw, path, depth, state, canonicalNode);
  }
  return undefined;
}

function canonicalUnary<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  canonicalNode: CanonicalNode<R>,
  operators: readonly string[],
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "operator", "operand"]);
  requireOperator(raw.operator, operators, path);
  return Object.freeze({
    kind: raw.kind,
    operator: raw.operator,
    operand: canonicalNode(raw.operand, [...path, "operand"], depth + 1, state),
  }) as KaladaV1Expression<R>;
}

function canonicalOperand<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  canonicalNode: CanonicalNode<R>,
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "operand"]);
  return Object.freeze({
    kind: raw.kind,
    operand: canonicalNode(raw.operand, [...path, "operand"], depth + 1, state),
  }) as KaladaV1Expression<R>;
}

function canonicalPair<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  canonicalNode: CanonicalNode<R>,
): KaladaV1Expression<R> {
  return Object.freeze({
    kind: raw.kind,
    left: canonicalNode(raw.left, [...path, "left"], depth + 1, state),
    right: canonicalNode(raw.right, [...path, "right"], depth + 1, state),
  }) as KaladaV1Expression<R>;
}

function canonicalBinary<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  canonicalNode: CanonicalNode<R>,
  operators: readonly string[],
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "operator", "left", "right"]);
  requireOperator(raw.operator, operators, path);
  return Object.freeze({
    kind: raw.kind,
    operator: raw.operator,
    left: canonicalNode(raw.left, [...path, "left"], depth + 1, state),
    right: canonicalNode(raw.right, [...path, "right"], depth + 1, state),
  }) as KaladaV1Expression<R>;
}

function canonicalOrdered<R extends JsonValue>(
  raw: Record<string, unknown>,
  path: Path,
  depth: number,
  state: CanonicalState<R>,
  canonicalNode: CanonicalNode<R>,
): KaladaV1Expression<R> {
  exact(raw, path, ["kind", "domain", "operator", "left", "right"]);
  if (raw.domain !== "number" && raw.domain !== "string") {
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "domain"]);
  }
  requireOperator(
    raw.operator,
    ["less-than", "less-than-or-equal", "greater-than", "greater-than-or-equal"],
    path,
  );
  return Object.freeze({
    kind: "ordered-comparison",
    domain: raw.domain,
    operator: raw.operator,
    left: canonicalNode(raw.left, [...path, "left"], depth + 1, state),
    right: canonicalNode(raw.right, [...path, "right"], depth + 1, state),
  }) as KaladaV1Expression<R>;
}

function requireOperator(
  input: unknown,
  allowed: readonly string[],
  path: Path,
): asserts input is string {
  if (typeof input !== "string" || !allowed.includes(input)) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", [...path, "operator"]);
  }
}

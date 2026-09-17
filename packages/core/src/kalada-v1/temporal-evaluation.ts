import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import {
  Duration,
  type DurationValue,
  Instant,
  type InstantValue,
  isDuration,
  isInstant,
} from "./temporal.js";
import type { KaladaV1Expression } from "./types.js";
import type { KaladaValue } from "./values.js";

type Path = readonly (string | number)[];
type TemporalExpression<R extends JsonValue> = Extract<
  KaladaV1Expression<R>,
  { kind: "instant" | "duration" | "current-instant" | `temporal-${string}` }
>;
type TemporalValue = InstantValue | DurationValue;

export function isTemporalExpression<R extends JsonValue>(
  node: KaladaV1Expression<R>,
): node is TemporalExpression<R> {
  return (
    node.kind === "instant" ||
    node.kind === "duration" ||
    node.kind === "current-instant" ||
    node.kind === "temporal-arithmetic" ||
    node.kind === "temporal-comparison"
  );
}

export function evaluateTemporalExpression<R extends JsonValue>(
  node: TemporalExpression<R>,
  path: Path,
  instant: InstantValue | undefined,
  evaluate: (node: KaladaV1Expression<R>, path: Path) => KaladaValue,
): KaladaValue {
  if (node.kind === "instant") return Instant.fromMilliseconds(node.milliseconds);
  if (node.kind === "duration") return Duration.fromMilliseconds(node.milliseconds);
  if (node.kind === "current-instant") {
    if (!instant) throw new KaladaFailure("KALADA_INSTANT_REQUIRED", path);
    return instant;
  }
  const left = temporalOperand(evaluate, node.left, [...path, "left"]);
  const right = temporalOperand(evaluate, node.right, [...path, "right"]);
  if (node.kind === "temporal-comparison") {
    assertSameType(left, right, [...path, "right"]);
    return compare(node.operator, left.milliseconds, right.milliseconds);
  }
  return node.operator === "add"
    ? add(left, right, [...path, "right"])
    : subtract(left, right, [...path, "right"]);
}

function temporalOperand<R extends JsonValue>(
  evaluate: (node: KaladaV1Expression<R>, path: Path) => KaladaValue,
  node: KaladaV1Expression<R>,
  path: Path,
): TemporalValue {
  const value = evaluate(node, path);
  if (!isInstant(value) && !isDuration(value)) mismatch(path);
  return value;
}

function add(left: TemporalValue, right: TemporalValue, path: Path): TemporalValue {
  if (isInstant(left) && isDuration(right)) {
    return Instant.fromMilliseconds(checked(left.milliseconds + right.milliseconds, path));
  }
  if (isDuration(left) && isDuration(right)) {
    return Duration.fromMilliseconds(checked(left.milliseconds + right.milliseconds, path));
  }
  return mismatch(path);
}

function subtract(left: TemporalValue, right: TemporalValue, path: Path): TemporalValue {
  const output = checked(left.milliseconds - right.milliseconds, path);
  if (isInstant(left) && isInstant(right)) return Duration.fromMilliseconds(output);
  if (isInstant(left) && isDuration(right)) return Instant.fromMilliseconds(output);
  if (isDuration(left) && isDuration(right)) return Duration.fromMilliseconds(output);
  return mismatch(path);
}

function assertSameType(left: TemporalValue, right: TemporalValue, path: Path): void {
  if ((isInstant(left) && !isInstant(right)) || (isDuration(left) && !isDuration(right))) {
    mismatch(path);
  }
}

function compare(
  operator: Extract<KaladaV1Expression, { kind: "temporal-comparison" }>["operator"],
  left: number,
  right: number,
): boolean {
  if (operator === "equal") return left === right;
  if (operator === "not-equal") return left !== right;
  if (operator === "less-than") return left < right;
  if (operator === "less-than-or-equal") return left <= right;
  if (operator === "greater-than") return left > right;
  return left >= right;
}

function checked(output: number, path: Path): number {
  if (!Number.isSafeInteger(output)) throw new KaladaFailure("KALADA_TEMPORAL_OVERFLOW", path);
  return Object.is(output, -0) ? 0 : output;
}

function mismatch(path: Path): never {
  throw new KaladaFailure("KALADA_TEMPORAL_TYPE_MISMATCH", path);
}

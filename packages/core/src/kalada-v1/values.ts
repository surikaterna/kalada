import { cloneJson, cloneJsonWithStats, deepEqualJson, type JsonValue } from "./json.js";

export type KaladaValue = JsonValue | OptionValue | ResultValue;
export type OptionValue = SomeValue | NoneValue;
export type ResultValue = OkValue | ErrValue;

declare const optionBrand: unique symbol;
declare const resultBrand: unique symbol;

export interface SomeValue {
  readonly [optionBrand]: true;
  readonly type: "Option";
  readonly variant: "some";
  readonly value: KaladaValue;
}

export interface NoneValue {
  readonly [optionBrand]: true;
  readonly type: "Option";
  readonly variant: "none";
}

export interface OkValue {
  readonly [resultBrand]: true;
  readonly type: "Result";
  readonly variant: "ok";
  readonly value: KaladaValue;
}

export interface ErrValue {
  readonly [resultBrand]: true;
  readonly type: "Result";
  readonly variant: "err";
  readonly value: KaladaValue;
}

const optionBrands = new WeakSet<object>();
const resultBrands = new WeakSet<object>();
const DEFAULT_VALUE_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxStringLength: 10_000,
});

function branded<T extends object>(brand: WeakSet<object>, value: T): T {
  Object.freeze(value);
  brand.add(value);
  return value;
}

function snapshot(value: KaladaValue): KaladaValue {
  if (isOption(value) || isResult(value)) return value;
  return cloneJson(value, DEFAULT_VALUE_LIMITS);
}

const NONE = branded(optionBrands, { type: "Option", variant: "none" } as unknown as NoneValue);

export const Option = Object.freeze({
  some(value: KaladaValue): SomeValue {
    return branded(optionBrands, {
      type: "Option",
      variant: "some",
      value: snapshot(value),
    } as unknown as SomeValue);
  },
  none(): NoneValue {
    return NONE;
  },
});

export const Result = Object.freeze({
  ok(value: KaladaValue): OkValue {
    return branded(resultBrands, {
      type: "Result",
      variant: "ok",
      value: snapshot(value),
    } as unknown as OkValue);
  },
  err(value: KaladaValue): ErrValue {
    return branded(resultBrands, {
      type: "Result",
      variant: "err",
      value: snapshot(value),
    } as unknown as ErrValue);
  },
});

export function isOption(value: unknown): value is OptionValue {
  return typeof value === "object" && value !== null && optionBrands.has(value);
}

export function isResult(value: unknown): value is ResultValue {
  return typeof value === "object" && value !== null && resultBrands.has(value);
}

export function equalKaladaValues(left: KaladaValue, right: KaladaValue): boolean {
  if (isOption(left) || isOption(right)) return equalOptions(left, right);
  if (isResult(left) || isResult(right)) return equalResults(left, right);
  return deepEqualJson(left, right);
}

export function validateKaladaValueLimits(
  value: KaladaValue,
  limits: {
    readonly maxDepth: number;
    readonly maxNodes: number;
    readonly maxStringLength: number;
  },
): void {
  const seen = new WeakSet<object>();
  let current = value;
  let depth = 0;
  let nodes = 0;
  while (isOption(current) || isResult(current)) {
    nodes += 1;
    if (depth > limits.maxDepth || nodes > limits.maxNodes) throw new RangeError("limit");
    if (seen.has(current)) throw new TypeError("cycle");
    seen.add(current);
    if (isOption(current) && current.variant === "none") return;
    current = current.value;
    depth += 1;
  }
  const remainingDepth = limits.maxDepth - depth;
  if (remainingDepth < 0) throw new RangeError("limit");
  cloneJsonWithStats(current, {
    maxDepth: remainingDepth,
    maxNodes: limits.maxNodes - nodes,
    maxStringLength: limits.maxStringLength,
  });
}

function equalOptions(left: KaladaValue, right: KaladaValue): boolean {
  if (!isOption(left) || !isOption(right) || left.variant !== right.variant) return false;
  if (left.variant === "none" || right.variant === "none") return true;
  return equalKaladaValues(left.value, right.value);
}

function equalResults(left: KaladaValue, right: KaladaValue): boolean {
  if (!isResult(left) || !isResult(right) || left.variant !== right.variant) return false;
  return equalKaladaValues(left.value, right.value);
}

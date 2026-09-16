import {
  type ExpressionOperatorDefinition,
  type ExpressionProfile,
  internalProfile,
} from "./profile.js";
import { ExpressionFailure } from "./result.js";
import type { JsonArray, JsonValue } from "./types.js";

function equal(left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== typeof right || left === null || right === null) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && arrayEqual(left, right);
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftObject = left as Readonly<Record<string, JsonValue>>;
    const rightObject = right as Readonly<Record<string, JsonValue>>;
    const leftKeys = Object.keys(leftObject);
    const rightKeys = Object.keys(rightObject);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) => Object.hasOwn(rightObject, key) && equal(leftObject[key]!, rightObject[key]!),
      )
    );
  }
  return left === right;
}

function arrayEqual(left: JsonArray, right: JsonArray): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]!));
}

function compare(
  args: readonly JsonValue[],
  predicate: (left: number | string, right: number | string) => boolean,
): boolean {
  const [left, right] = args;
  if (!sameComparableType(left, right)) throw new ExpressionFailure("EXPRESSION_TYPE_MISMATCH", []);
  return predicate(left as number | string, right as number | string);
}

function sameComparableType(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): left is number | string {
  return (
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string")
  );
}

function finiteNumbers(args: readonly JsonValue[]): readonly number[] {
  if (args.some((value) => typeof value !== "number")) {
    throw new ExpressionFailure("EXPRESSION_TYPE_MISMATCH", []);
  }
  if (args.some((value) => !Number.isFinite(value)))
    throw new ExpressionFailure("EXPRESSION_NON_FINITE_RESULT", []);
  return args as readonly number[];
}

function arithmetic(
  args: readonly JsonValue[],
  calculate: (left: number, right: number) => number,
): number {
  const [left, right] = finiteNumbers(args);
  const result = calculate(left!, right!);
  if (!Number.isFinite(result)) throw new ExpressionFailure("EXPRESSION_NON_FINITE_RESULT", []);
  return result;
}

type StandardStrategy = "and" | "or" | "coalesce" | "exists" | "if";
type StandardDefinition = ExpressionOperatorDefinition & { readonly strategy?: StandardStrategy };
const definitions: readonly StandardDefinition[] = [
  { name: "eq", arity: 2, resultType: "boolean", execute: ([left, right]) => equal(left!, right!) },
  {
    name: "neq",
    arity: 2,
    resultType: "boolean",
    execute: ([left, right]) => !equal(left!, right!),
  },
  {
    name: "gt",
    arity: 2,
    resultType: "boolean",
    execute: (args) => compare(args, (left, right) => left > right),
  },
  {
    name: "gte",
    arity: 2,
    resultType: "boolean",
    execute: (args) => compare(args, (left, right) => left >= right),
  },
  {
    name: "lt",
    arity: 2,
    resultType: "boolean",
    execute: (args) => compare(args, (left, right) => left < right),
  },
  {
    name: "lte",
    arity: 2,
    resultType: "boolean",
    execute: (args) => compare(args, (left, right) => left <= right),
  },
  {
    name: "not",
    arity: 1,
    inputTypes: ["boolean"],
    resultType: "boolean",
    execute: ([value]) => !value,
  },
  {
    name: "in",
    arity: 2,
    resultType: "boolean",
    execute: ([value, choices]) => membership(value!, choices, false),
  },
  {
    name: "nin",
    arity: 2,
    resultType: "boolean",
    execute: ([value, choices]) => membership(value!, choices, true),
  },
  {
    name: "add",
    arity: 2,
    inputTypes: ["number", "number"],
    resultType: "number",
    execute: (args) => arithmetic(args, (a, b) => a + b),
  },
  {
    name: "sub",
    arity: 2,
    inputTypes: ["number", "number"],
    resultType: "number",
    execute: (args) => arithmetic(args, (a, b) => a - b),
  },
  {
    name: "mul",
    arity: 2,
    inputTypes: ["number", "number"],
    resultType: "number",
    execute: (args) => arithmetic(args, (a, b) => a * b),
  },
  {
    name: "div",
    arity: 2,
    inputTypes: ["number", "number"],
    resultType: "number",
    execute: divide,
  },
  {
    name: "and",
    minArgs: 1,
    maxArgs: 32,
    inputTypes: ["boolean"],
    resultType: "boolean",
    strategy: "and",
    execute: (args) => args.every(Boolean),
  },
  {
    name: "or",
    minArgs: 1,
    maxArgs: 32,
    inputTypes: ["boolean"],
    resultType: "boolean",
    strategy: "or",
    execute: (args) => args.some(Boolean),
  },
  { name: "coalesce", minArgs: 1, maxArgs: 32, strategy: "coalesce", execute: (args) => args[0]! },
  { name: "exists", arity: 1, resultType: "boolean", strategy: "exists", execute: () => true },
  {
    name: "if",
    arity: 3,
    inputTypes: ["boolean", "any", "any"],
    strategy: "if",
    execute: ([condition, whenTrue, whenFalse]) => (condition ? whenTrue! : whenFalse!),
  },
];

function membership(value: JsonValue, choices: JsonValue | undefined, negate: boolean): boolean {
  if (!Array.isArray(choices)) throw new ExpressionFailure("EXPRESSION_TYPE_MISMATCH", []);
  const includes = choices.some((candidate) => equal(value, candidate));
  return negate ? !includes : includes;
}

function divide(args: readonly JsonValue[]): number {
  const [left, right] = finiteNumbers(args);
  if (Object.is(right, 0) || Object.is(right, -0)) {
    throw new ExpressionFailure("EXPRESSION_DIVISION_BY_ZERO", []);
  }
  return arithmetic([left!, right!], (a, b) => a / b);
}

/** Strict, structurally immutable built-in profile, isolated from legacy and custom registries. */
export const standardV1: ExpressionProfile = internalProfile.createStandardProfile(
  "standard-v1",
  definitions,
);

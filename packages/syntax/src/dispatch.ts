import type { KaladaV1DiagnosticCode } from "@kalada/core";
import type { KaladaBinaryOperator } from "./cst-types.js";
import {
  isCallable,
  isOption,
  joinTypes,
  primitive,
  type StaticType,
  typeIs,
} from "./static-types.js";

export type DispatchFamily =
  | "equality"
  | "ordered-number"
  | "ordered-string"
  | "temporal-comparison"
  | "membership"
  | "numeric-binary"
  | "temporal-arithmetic"
  | "boolean-logical"
  | "boolean-xor"
  | "option-coalesce";

export interface DispatchResult {
  readonly family: DispatchFamily;
  readonly type: StaticType;
}

export class DispatchFailure extends Error {
  readonly code: Extract<
    KaladaV1DiagnosticCode,
    | "KALADA_OPERATOR_TYPE"
    | "KALADA_OPERATOR_AMBIGUOUS"
    | "KALADA_OPTION_REQUIRED"
    | "KALADA_FIELD_TYPE_MISMATCH"
  >;
  readonly operand:
    | "left"
    | "right"
    | "operator"
    | "option"
    | "fallback"
    | "condition"
    | "target"
    | "needle"
    | "array"
    | "else";

  constructor(code: DispatchFailure["code"], operand: DispatchFailure["operand"]) {
    super(code);
    this.code = code;
    this.operand = operand;
  }
}

export function dispatchBinary(
  operator: KaladaBinaryOperator,
  left: StaticType,
  right: StaticType,
): DispatchResult {
  if (operator === "==" || operator === "!=") return equality(left, right);
  if (["<", "<=", ">", ">="].includes(operator)) return ordering(left, right);
  if (operator === "in") return membership(left, right);
  if (operator === "+" || operator === "-") return additive(operator, left, right);
  if (["*", "/", "%"].includes(operator)) return numeric(left, right);
  if (operator === "&&" || operator === "||") return booleanLogical(left, right);
  if (operator === "xor") return booleanXor(left, right);
  return coalesce(left, right);
}

export function dispatchUnary(operator: "!" | "+" | "-", operand: StaticType): DispatchResult {
  requireType(operand, operator === "!" ? "boolean" : "number", "left");
  return {
    family: operator === "!" ? "boolean-logical" : "numeric-binary",
    type: primitive(operator === "!" ? "boolean" : "number"),
  };
}

export function dispatchField(target: StaticType, optional: boolean): StaticType {
  if (!optional) {
    if (target !== "dynamic" && !typeIs(target, "json"))
      fail("KALADA_FIELD_TYPE_MISMATCH", "target");
    return "dynamic";
  }
  if (target === "dynamic") return option("dynamic");
  if (typeIs(target, "null")) return option(primitive("null"));
  if (typeIs(target, "json")) return option("dynamic");
  if (isOption(target) && validOptionalPayload(target.value))
    return option(typeIs(target.value, "null") ? primitive("null") : "dynamic");
  return fail("KALADA_FIELD_TYPE_MISMATCH", "target");
}

export function dispatchConditional(
  condition: StaticType,
  thenType: StaticType,
  elseType: StaticType,
): StaticType {
  requireType(condition, "boolean", "condition");
  const joined = joinTypes(thenType, elseType);
  return joined ?? fail("KALADA_OPERATOR_TYPE", "else");
}

function equality(left: StaticType, right: StaticType): DispatchResult {
  if (isCallable(left)) fail("KALADA_OPERATOR_TYPE", "left");
  if (isCallable(right)) fail("KALADA_OPERATOR_TYPE", "right");
  return { family: "equality", type: primitive("boolean") };
}

function ordering(left: StaticType, right: StaticType): DispatchResult {
  const leftDomain = orderedDomain(left);
  const rightDomain = orderedDomain(right);
  if (leftDomain === "unsupported") fail("KALADA_OPERATOR_TYPE", "left");
  if (rightDomain === "unsupported") fail("KALADA_OPERATOR_TYPE", "right");
  if (leftDomain === "dynamic" && rightDomain === "dynamic")
    fail("KALADA_OPERATOR_AMBIGUOUS", "operator");
  const domain = leftDomain === "dynamic" ? rightDomain : leftDomain;
  if (rightDomain !== "dynamic" && leftDomain !== "dynamic" && leftDomain !== rightDomain)
    fail("KALADA_OPERATOR_TYPE", "right");
  const family =
    domain === "number"
      ? "ordered-number"
      : domain === "string"
        ? "ordered-string"
        : "temporal-comparison";
  return { family, type: primitive("boolean") };
}

function membership(left: StaticType, right: StaticType): DispatchResult {
  if (isCallable(left)) fail("KALADA_OPERATOR_TYPE", "needle");
  if (right !== "dynamic" && ("shape" in right || right.kind !== "array-type"))
    fail("KALADA_OPERATOR_TYPE", "array");
  return { family: "membership", type: primitive("boolean") };
}

function additive(operator: "+" | "-", left: StaticType, right: StaticType): DispatchResult {
  if (left === "dynamic" && right === "dynamic") fail("KALADA_OPERATOR_AMBIGUOUS", "operator");
  if (typeIs(left, "number") || (left === "dynamic" && typeIs(right, "number")))
    return numeric(left, right);
  if (typeIs(left, "number")) return numeric(left, right);
  if (isTemporalCandidate(left, right, operator)) return temporalResult(operator, left, right);
  if (left !== "dynamic" && !isTemporal(left)) fail("KALADA_OPERATOR_TYPE", "left");
  return fail("KALADA_OPERATOR_TYPE", "right");
}

function numeric(left: StaticType, right: StaticType): DispatchResult {
  requireType(left, "number", "left");
  requireType(right, "number", "right");
  return { family: "numeric-binary", type: primitive("number") };
}

function temporalResult(operator: "+" | "-", left: StaticType, right: StaticType): DispatchResult {
  let type: StaticType = "dynamic";
  if (operator === "+" && typeIs(left, "Instant")) type = primitive("Instant");
  if (operator === "+" && typeIs(left, "Duration")) type = primitive("Duration");
  if (operator === "-" && typeIs(left, "Duration")) type = primitive("Duration");
  if (operator === "-" && typeIs(left, "Instant") && typeIs(right, "Duration"))
    type = primitive("Instant");
  if (operator === "-" && typeIs(right, "Instant")) type = primitive("Duration");
  return { family: "temporal-arithmetic", type };
}

function booleanLogical(left: StaticType, right: StaticType): DispatchResult {
  requireType(left, "boolean", "left");
  requireType(right, "boolean", "right");
  return { family: "boolean-logical", type: primitive("boolean") };
}

function booleanXor(left: StaticType, right: StaticType): DispatchResult {
  const result = booleanLogical(left, right);
  return { ...result, family: "boolean-xor" };
}

function coalesce(left: StaticType, right: StaticType): DispatchResult {
  const payload =
    left === "dynamic"
      ? "dynamic"
      : isOption(left)
        ? left.value
        : fail("KALADA_OPTION_REQUIRED", "option");
  const joined = joinTypes(payload, right);
  if (joined === null) fail("KALADA_OPERATOR_TYPE", "fallback");
  return { family: "option-coalesce", type: joined };
}

function orderedDomain(
  type: StaticType,
): "dynamic" | "number" | "string" | "Instant" | "Duration" | "unsupported" {
  if (type === "dynamic") return "dynamic";
  if ("shape" in type) return "unsupported";
  if (type.kind !== "primitive-type") return "unsupported";
  return ["number", "string", "Instant", "Duration"].includes(type.name)
    ? (type.name as "number" | "string" | "Instant" | "Duration")
    : "unsupported";
}

function isTemporalCandidate(left: StaticType, right: StaticType, operator: "+" | "-"): boolean {
  if (operator === "+")
    return (
      (typeIs(left, "Instant") && (typeIs(right, "Duration") || right === "dynamic")) ||
      (typeIs(left, "Duration") && (typeIs(right, "Duration") || right === "dynamic")) ||
      (left === "dynamic" && typeIs(right, "Duration"))
    );
  return (
    (typeIs(left, "Instant") && (isTemporal(right) || right === "dynamic")) ||
    (typeIs(left, "Duration") && (typeIs(right, "Duration") || right === "dynamic")) ||
    (left === "dynamic" && isTemporal(right))
  );
}

function isTemporal(type: StaticType): boolean {
  return typeIs(type, "Instant") || typeIs(type, "Duration");
}

function validOptionalPayload(type: StaticType): boolean {
  return type === "dynamic" || typeIs(type, "json") || typeIs(type, "null");
}

function option(value: StaticType): StaticType {
  return Object.freeze({ shape: "option", value });
}

function requireType(
  type: StaticType,
  name: "number" | "boolean",
  operand: "left" | "right" | "condition",
): void {
  if (type !== "dynamic" && !typeIs(type, name)) fail("KALADA_OPERATOR_TYPE", operand);
}

function fail(code: DispatchFailure["code"], operand: DispatchFailure["operand"]): never {
  throw new DispatchFailure(code, operand);
}

import type { EvaluationFrame, Path } from "./evaluation-frames.js";
import { charge, deliver, evaluate, fail, type MachineState, push } from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import { isCallable, type RuntimeValue } from "./runtime-values.js";
import type { KaladaV1Expression } from "./types.js";
import { compareKaladaValues, type KaladaValue } from "./values.js";

export function enterOperator<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "equality" | "ordered-comparison" | "membership" }>,
  path: Path,
  state: MachineState<R>,
): void {
  if (node.kind === "membership") {
    push(
      { kind: "membership", phase: "needle", path, array: node.array, needle: null },
      [...path, "needle"],
      state,
    );
    evaluate(node.needle, [...path, "needle"], state.environment, state);
    return;
  }
  const frame =
    node.kind === "equality"
      ? {
          kind: node.kind,
          phase: "left",
          path,
          operator: node.operator,
          right: node.right,
          left: null,
        }
      : {
          kind: node.kind,
          phase: "left",
          path,
          domain: node.domain,
          operator: node.operator,
          right: node.right,
          left: null,
        };
  push(frame as EvaluationFrame<R>, [...path, "left"], state);
  evaluate(node.left, [...path, "left"], state.environment, state);
}

export function deliverOperator<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "equality" | "ordered-comparison" | "membership" }>,
  state: MachineState<R>,
): void {
  if (frame.kind === "membership") {
    deliverMembership(frame, state);
    return;
  }
  deliverBinary(frame, state);
}

function deliverBinary<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "equality" | "ordered-comparison" }>,
  state: MachineState<R>,
): void {
  const value = state.value as RuntimeValue;
  validateOperand(frame, value);
  if (frame.phase === "left") {
    frame.phase = "right";
    frame.left = value;
    evaluate(frame.right, [...frame.path, "right"], state.environment, state);
    return;
  }
  state.stack.pop();
  const output =
    frame.kind === "equality"
      ? applyEquality(
          frame.operator,
          frame.left as KaladaValue,
          value as KaladaValue,
          frame.path,
          state,
        )
      : applyOrdering(frame, frame.left as number | string, value as number | string);
  deliver(output, state);
}

function validateOperand<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "equality" | "ordered-comparison" }>,
  value: RuntimeValue,
): void {
  const path = [...frame.path, frame.phase];
  if (isCallable(value)) fail("KALADA_OPERATOR_TYPE", path);
  if (frame.kind === "ordered-comparison") {
    const valid =
      frame.domain === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : typeof value === "string";
    if (!valid) fail("KALADA_OPERATOR_TYPE", path);
  }
}

function deliverMembership<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "membership" }>,
  state: MachineState<R>,
): void {
  const value = state.value as RuntimeValue;
  if (frame.phase === "needle") {
    if (isCallable(value)) fail("KALADA_OPERATOR_TYPE", [...frame.path, "needle"]);
    frame.phase = "array";
    frame.needle = value;
    evaluate(frame.array, [...frame.path, "array"], state.environment, state);
    return;
  }
  if (isCallable(value) || !Array.isArray(value)) {
    fail("KALADA_OPERATOR_TYPE", [...frame.path, "array"]);
  }
  state.stack.pop();
  deliver(arrayIncludes(frame.needle as KaladaValue, value, frame.path, state), state);
}

function applyEquality<R extends JsonValue>(
  operator: "equal" | "not-equal",
  left: KaladaValue,
  right: KaladaValue,
  path: Path,
  state: MachineState<R>,
): boolean {
  const equal = compareKaladaValues(left, right, () => charge(path, state));
  return operator === "equal" ? equal : !equal;
}

function arrayIncludes<R extends JsonValue>(
  needle: KaladaValue,
  array: readonly RuntimeValue[],
  path: Path,
  state: MachineState<R>,
): boolean {
  for (const item of array) {
    if (isCallable(item)) fail("KALADA_OPERATOR_TYPE", [...path, "array"]);
    if (compareKaladaValues(needle, item, () => charge(path, state))) return true;
  }
  return false;
}

function applyOrdering<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "ordered-comparison" }>,
  left: number | string,
  right: number | string,
): boolean {
  const order =
    frame.domain === "number"
      ? (left as number) - (right as number)
      : compareStrings(left as string, right as string);
  if (frame.operator === "less-than") return order < 0;
  if (frame.operator === "less-than-or-equal") return order <= 0;
  if (frame.operator === "greater-than") return order > 0;
  return order >= 0;
}

function compareStrings(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

import type { EvaluationFrame, Path } from "./evaluation-frames.js";
import { charge, deliver, evaluate, fail, type MachineState, push } from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import { isCallable, type RuntimeValue } from "./runtime-values.js";
import type { KaladaV1Expression } from "./types.js";
import { compareKaladaValues, type KaladaValue } from "./values.js";

export function enterOperator<R extends JsonValue>(
  node: Extract<
    KaladaV1Expression<R>,
    {
      kind:
        | "equality"
        | "ordered-comparison"
        | "membership"
        | "numeric-binary"
        | "numeric-unary"
        | "boolean-not"
        | "boolean-logical"
        | "boolean-xor";
    }
  >,
  path: Path,
  state: MachineState<R>,
): void {
  if (node.kind === "membership") {
    enterMembership(node, path, state);
    return;
  }
  if (node.kind === "numeric-unary" || node.kind === "boolean-not") {
    enterUnary(node, path, state);
    return;
  }
  enterBinary(node, path, state);
}

function enterMembership<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "membership" }>,
  path: Path,
  state: MachineState<R>,
): void {
  push(
    { kind: "membership", phase: "needle", path, array: node.array, needle: null },
    [...path, "needle"],
    state,
  );
  evaluate(node.needle, [...path, "needle"], state.environment, state);
}

function enterUnary<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "numeric-unary" | "boolean-not" }>,
  path: Path,
  state: MachineState<R>,
): void {
  const frame: EvaluationFrame<R> =
    node.kind === "numeric-unary"
      ? { kind: node.kind, phase: "operand", path, operator: node.operator }
      : { kind: node.kind, phase: "operand", path };
  push(frame, [...path, "operand"], state);
  evaluate(node.operand, [...path, "operand"], state.environment, state);
}

function enterBinary<R extends JsonValue>(
  node: Extract<
    KaladaV1Expression<R>,
    {
      kind:
        | "equality"
        | "ordered-comparison"
        | "numeric-binary"
        | "boolean-logical"
        | "boolean-xor";
    }
  >,
  path: Path,
  state: MachineState<R>,
): void {
  const shared = { phase: "left", path, right: node.right } as const;
  const frame: EvaluationFrame<R> =
    node.kind === "ordered-comparison"
      ? { kind: node.kind, domain: node.domain, operator: node.operator, left: null, ...shared }
      : node.kind === "boolean-xor"
        ? { kind: node.kind, left: null, ...shared }
        : node.kind === "boolean-logical"
          ? { kind: node.kind, operator: node.operator, ...shared }
          : node.kind === "equality"
            ? { kind: node.kind, operator: node.operator, left: null, ...shared }
            : { kind: node.kind, operator: node.operator, left: null, ...shared };
  push(frame, [...path, "left"], state);
  evaluate(node.left, [...path, "left"], state.environment, state);
}

export function deliverOperator<R extends JsonValue>(
  frame: Extract<
    EvaluationFrame<R>,
    {
      kind:
        | "equality"
        | "ordered-comparison"
        | "membership"
        | "numeric-binary"
        | "numeric-unary"
        | "boolean-not"
        | "boolean-logical"
        | "boolean-xor";
    }
  >,
  state: MachineState<R>,
): void {
  if (frame.kind === "membership") {
    deliverMembership(frame, state);
    return;
  }
  if (frame.kind === "numeric-unary" || frame.kind === "boolean-not") {
    deliverUnary(frame, state);
    return;
  }
  if (frame.kind === "numeric-binary") {
    deliverNumericBinary(frame, state);
    return;
  }
  if (frame.kind === "boolean-logical") {
    deliverLogical(frame, state);
    return;
  }
  if (frame.kind === "boolean-xor") {
    deliverXor(frame, state);
    return;
  }
  deliverComparison(frame, state);
}

function deliverComparison<R extends JsonValue>(
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

function deliverUnary<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "numeric-unary" | "boolean-not" }>,
  state: MachineState<R>,
): void {
  const value = state.value as RuntimeValue;
  if (frame.kind === "boolean-not") {
    const operand = requireBoolean(value, [...frame.path, "operand"]);
    state.stack.pop();
    deliver(!operand, state);
    return;
  }
  const operand = requireNumber(value, [...frame.path, "operand"]);
  const result = numericResult(frame.operator === "plus" ? +operand : -operand, frame.path);
  state.stack.pop();
  deliver(result, state);
}

function deliverNumericBinary<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "numeric-binary" }>,
  state: MachineState<R>,
): void {
  const path = [...frame.path, frame.phase];
  const value = requireNumber(state.value as RuntimeValue, path);
  if (frame.phase === "left") {
    frame.phase = "right";
    frame.left = value;
    evaluate(frame.right, [...frame.path, "right"], state.environment, state);
    return;
  }
  if ((frame.operator === "divide" || frame.operator === "remainder") && value === 0) {
    fail("KALADA_NUMERIC_ZERO_DIVISOR", path);
  }
  state.stack.pop();
  const result = applyNumeric(frame.operator, frame.left as number, value);
  deliver(numericResult(result, frame.path), state);
}

function deliverLogical<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "boolean-logical" }>,
  state: MachineState<R>,
): void {
  const value = requireBoolean(state.value as RuntimeValue, [...frame.path, frame.phase]);
  if (frame.phase === "left" && shouldShortCircuit(frame.operator, value)) {
    state.stack.pop();
    deliver(value, state);
    return;
  }
  if (frame.phase === "left") {
    frame.phase = "right";
    evaluate(frame.right, [...frame.path, "right"], state.environment, state);
    return;
  }
  state.stack.pop();
  deliver(value, state);
}

function deliverXor<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "boolean-xor" }>,
  state: MachineState<R>,
): void {
  const value = requireBoolean(state.value as RuntimeValue, [...frame.path, frame.phase]);
  if (frame.phase === "left") {
    frame.phase = "right";
    frame.left = value;
    evaluate(frame.right, [...frame.path, "right"], state.environment, state);
    return;
  }
  state.stack.pop();
  deliver((frame.left as boolean) !== value, state);
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

function requireNumber(value: RuntimeValue, path: Path): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("KALADA_OPERATOR_TYPE", path);
  return value;
}

function requireBoolean(value: RuntimeValue, path: Path): boolean {
  if (typeof value !== "boolean") fail("KALADA_OPERATOR_TYPE", path);
  return value;
}

function shouldShortCircuit(operator: "and" | "or", left: boolean): boolean {
  return operator === "and" ? !left : left;
}

function applyNumeric(
  operator: "add" | "subtract" | "multiply" | "divide" | "remainder",
  left: number,
  right: number,
): number {
  if (operator === "add") return left + right;
  if (operator === "subtract") return left - right;
  if (operator === "multiply") return left * right;
  if (operator === "divide") return left / right;
  return left % right;
}

function numericResult(value: number, path: Path): number {
  if (!Number.isFinite(value)) fail("KALADA_NUMERIC_NON_FINITE", path);
  return Object.is(value, -0) ? 0 : value;
}

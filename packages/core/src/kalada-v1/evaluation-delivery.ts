import { deliverControl } from "./control-evaluation.js";
import { type EvaluationFrame, functionEnvironment, type Path } from "./evaluation-frames.js";
import {
  charge,
  deliver,
  ensureCapacity,
  evaluate,
  fail,
  type MachineState,
  push,
  reserveCollectionIteration,
} from "./evaluation-state.js";
import { applyFieldAccess } from "./field-access.js";
import { cloneJson, type JsonValue } from "./json.js";
import { deliverOperator } from "./operator-evaluation.js";
import {
  callableType,
  isCallable,
  matchesType,
  type RuntimeEnvironment,
  type RuntimeValue,
  type UserClosure,
} from "./runtime-values.js";
import { deliverTemporal } from "./temporal-delivery.js";
import type { KaladaV1Expression } from "./types.js";
import { isOption, isResult, Option, Result } from "./values.js";

export function deliverFrame<R extends JsonValue>(state: MachineState<R>): void {
  const frame = state.stack[state.stack.length - 1] as EvaluationFrame<R>;
  switch (frame.kind) {
    case "field-access":
    case "optional-field-access":
      state.stack.pop();
      deliver(
        applyFieldAccess(frame.kind, state.value as RuntimeValue, frame.field, frame.path),
        state,
      );
      break;
    case "binding":
      deliverBinding(frame, state);
      break;
    case "constructor":
      deliverConstructor(frame, state);
      break;
    case "match":
      deliverMatch(frame, state);
      break;
    case "temporal-binary":
      deliverTemporal(frame, state);
      break;
    case "conditional":
    case "option-coalesce":
      deliverControl(frame, state);
      break;
    case "function-group-body":
      restore(frame.outer, state);
      break;
    case "call-callee":
      deliverCallee(frame, state);
      break;
    case "call-arguments":
      deliverArgument(frame, state);
      break;
    case "user-return":
      deliverReturn(frame, state);
      break;
    case "core-iteration":
      deliverCoreCallback(frame, state);
      break;
    default:
      deliverOperator(frame, state);
  }
}

function deliverBinding<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "binding" }>,
  state: MachineState<R>,
): void {
  if (frame.phase === "body") {
    restore(frame.outer, state);
    return;
  }
  frame.phase = "body";
  const nested = new Map(state.environment);
  nested.set(frame.name, state.value as RuntimeValue);
  evaluate(frame.body, [...frame.path, "body"], nested, state);
}

function deliverConstructor<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "constructor" }>,
  state: MachineState<R>,
): void {
  state.stack.pop();
  const value = state.value as RuntimeValue;
  if (isCallable(value)) fail("KALADA_FUNCTION_ESCAPE", [...frame.path, "value"]);
  if (frame.type === "Option") deliver(Option.some(value), state);
  else deliver(frame.variant === "ok" ? Result.ok(value) : Result.err(value), state);
}

function deliverMatch<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "match" }>,
  state: MachineState<R>,
): void {
  if (frame.phase === "arm") {
    restore(frame.outer, state);
    return;
  }
  const value = state.value as RuntimeValue;
  const valid = !isCallable(value) && (frame.type === "Option" ? isOption(value) : isResult(value));
  if (!valid) fail("KALADA_MATCH_TYPE_MISMATCH", [...frame.path, "value"]);
  const variant = (value as ReturnType<typeof Option.none> | ReturnType<typeof Result.ok>).variant;
  const index = frame.arms.findIndex((arm) => arm.variant === variant);
  const arm = frame.arms[index];
  if (!arm) fail("KALADA_INVALID_INPUT", [...frame.path, "arms"]);
  frame.phase = "arm";
  frame.scrutinee = value;
  frame.selected = index;
  evaluate(
    arm.body,
    [...frame.path, "arms", index, "body"],
    bindArm(frame.outer, arm.binding, value),
    state,
  );
}

function bindArm(
  environment: RuntimeEnvironment,
  name: string | undefined,
  value: RuntimeValue,
): RuntimeEnvironment {
  if (!name || isCallable(value) || (isOption(value) && value.variant === "none"))
    return environment;
  const nested = new Map(environment);
  if (isOption(value) || isResult(value)) nested.set(name, value.value);
  return nested;
}

function deliverCallee<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "call-callee" }>,
  state: MachineState<R>,
): void {
  charge([...frame.path, "callee"], state);
  state.stack.pop();
  const callable = state.value as RuntimeValue;
  if (!isCallable(callable)) fail("KALADA_NOT_CALLABLE", [...frame.path, "callee"]);
  const expected = callable.callable === "user" ? callable.parameters.length : 2;
  if (frame.arguments.length !== expected)
    fail("KALADA_FUNCTION_ARITY", [...frame.path, "arguments"]);
  if (frame.arguments.length === 0) {
    dispatch(callable, [], frame.path, state);
    return;
  }
  push(
    {
      kind: "call-arguments",
      phase: "argument",
      path: frame.path,
      callable,
      arguments: frame.arguments,
      values: [],
      index: 0,
    },
    [...frame.path, "arguments"],
    state,
  );
  evaluate(
    frame.arguments[0] as KaladaV1Expression<R>,
    [...frame.path, "arguments", 0],
    state.environment,
    state,
  );
}

function deliverArgument<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "call-arguments" }>,
  state: MachineState<R>,
): void {
  const path = [...frame.path, "arguments", frame.index];
  charge(path, state);
  const callable = frame.callable;
  if (!isCallable(callable)) fail("KALADA_NOT_CALLABLE", [...frame.path, "callee"]);
  const type = callableType(callable).parameters[frame.index];
  if (type && !matchesType(state.value as RuntimeValue, type))
    fail("KALADA_FUNCTION_TYPE_MISMATCH", path);
  frame.values.push(state.value as RuntimeValue);
  frame.index += 1;
  if (frame.index < frame.arguments.length) {
    evaluate(
      frame.arguments[frame.index] as KaladaV1Expression<R>,
      [...frame.path, "arguments", frame.index],
      state.environment,
      state,
    );
    return;
  }
  state.stack.pop();
  dispatch(callable, frame.values, frame.path, state);
}

function dispatch<R extends JsonValue>(
  callable: RuntimeValue,
  values: readonly RuntimeValue[],
  path: Path,
  state: MachineState<R>,
): void {
  if (!isCallable(callable)) fail("KALADA_NOT_CALLABLE", [...path, "callee"]);
  if (callable.callable === "core") {
    dispatchCore(callable.name, values, path, state);
    return;
  }
  dispatchUser(callable as UserClosure<R>, values, path, state);
}

function dispatchUser<R extends JsonValue>(
  closure: UserClosure<R>,
  values: readonly RuntimeValue[],
  path: Path,
  state: MachineState<R>,
): void {
  if (state.callDepth >= state.limits.maxCallDepth) fail("KALADA_CALL_DEPTH_LIMIT", path);
  ensureCapacity(path, state);
  charge(path, state);
  state.callDepth += 1;
  state.stack.push({
    kind: "user-return",
    phase: "body",
    path,
    name: closure.name,
    returns: closure.returns,
    caller: state.environment,
  });
  evaluate(closure.body, [...closure.path, "body"], functionEnvironment(closure, values), state);
}

function dispatchCore<R extends JsonValue>(
  operator: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>["operator"],
  values: readonly RuntimeValue[],
  path: Path,
  state: MachineState<R>,
): void {
  const input = values[0] as readonly JsonValue[];
  if (input.length > state.limits.maxCollectionLength) {
    fail("KALADA_COLLECTION_LIMIT", [...path, "arguments", 0]);
  }
  if (state.callDepth >= state.limits.maxCallDepth) fail("KALADA_CALL_DEPTH_LIMIT", path);
  ensureCapacity(path, state);
  charge(path, state);
  state.callDepth += 1;
  const frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }> = {
    kind: "core-iteration",
    phase: "ready",
    path,
    operator,
    callback: values[1] as RuntimeValue,
    input,
    index: 0,
    partial: operator === "some" ? false : operator === "every" ? true : [],
  };
  state.stack.push(frame);
  if (input.length === 0) finishCore(frame, state);
  else dispatchCoreCallback(frame, state);
}

function dispatchCoreCallback<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>,
  state: MachineState<R>,
): void {
  frame.phase = "callback";
  reserveCollectionIteration(frame.path, state);
  dispatch(
    frame.callback,
    [frame.input[frame.index] as JsonValue, frame.index],
    [...frame.path, "arguments", 1],
    state,
  );
}

function deliverCoreCallback<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>,
  state: MachineState<R>,
): void {
  charge(frame.path, state);
  const value = state.value as RuntimeValue;
  validateCoreResult(frame, value);
  updateCoreResult(frame, value as JsonValue | boolean);
  if (coreFinished(frame, value)) {
    finishCore(frame, state);
    return;
  }
  frame.index += 1;
  if (frame.index === frame.input.length) finishCore(frame, state);
  else dispatchCoreCallback(frame, state);
}

function validateCoreResult<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>,
  value: RuntimeValue,
): void {
  const expected = {
    kind: "primitive-type",
    name: frame.operator === "map" ? "json" : "boolean",
  } as const;
  if (!matchesType(value, expected)) {
    fail("KALADA_COLLECTION_TYPE_MISMATCH", [...frame.path, "arguments", 1]);
  }
}

function updateCoreResult<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>,
  value: JsonValue | boolean,
): void {
  if (frame.operator === "map") (frame.partial as JsonValue[]).push(value as JsonValue);
  if (frame.operator === "filter" && value) {
    (frame.partial as JsonValue[]).push(frame.input[frame.index] as JsonValue);
  }
  if (frame.operator === "some" && value) frame.partial = true;
  if (frame.operator === "every" && !value) frame.partial = false;
}

function coreFinished<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>,
  value: RuntimeValue,
): boolean {
  return (
    (frame.operator === "some" && value === true) || (frame.operator === "every" && value === false)
  );
}

function finishCore<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "core-iteration" }>,
  state: MachineState<R>,
): void {
  const output = Array.isArray(frame.partial)
    ? validateCollectionOutput(frame.partial, frame.path, state)
    : frame.partial;
  state.stack.pop();
  state.callDepth -= 1;
  deliver(output, state);
}

function validateCollectionOutput<R extends JsonValue>(
  output: JsonValue[],
  path: Path,
  state: MachineState<R>,
): JsonValue[] {
  try {
    cloneJson(output, {
      maxDepth: state.limits.maxValueDepth,
      maxNodes: state.limits.maxValueNodes,
      maxStringLength: state.limits.maxStringLength,
    });
  } catch {
    fail("KALADA_LIMIT_EXCEEDED", path);
  }
  return Object.freeze(output) as JsonValue[];
}

function deliverReturn<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "user-return" }>,
  state: MachineState<R>,
): void {
  charge(frame.path, state);
  state.stack.pop();
  state.environment = frame.caller;
  state.callDepth -= 1;
  if (!matchesType(state.value as RuntimeValue, frame.returns))
    fail("KALADA_FUNCTION_TYPE_MISMATCH", frame.path);
}

function restore<R extends JsonValue>(
  environment: RuntimeEnvironment,
  state: MachineState<R>,
): void {
  state.stack.pop();
  state.environment = environment;
}

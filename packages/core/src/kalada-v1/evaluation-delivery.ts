import { type EvaluationFrame, functionEnvironment, type Path } from "./evaluation-frames.js";
import {
  charge,
  deliver,
  ensureCapacity,
  evaluate,
  fail,
  type MachineState,
  push,
} from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import {
  callableType,
  isCallable,
  matchesType,
  type RuntimeEnvironment,
  type RuntimeValue,
  type UserClosure,
} from "./runtime-values.js";
import { isDuration, isInstant } from "./temporal.js";
import { applyTemporalBinary } from "./temporal-evaluation.js";
import type { KaladaV1Expression } from "./types.js";
import { isOption, isResult, type KaladaValue, Option, Result } from "./values.js";

export function deliverFrame<R extends JsonValue>(state: MachineState<R>): void {
  const frame = state.stack[state.stack.length - 1] as EvaluationFrame<R>;
  switch (frame.kind) {
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
    default:
      fail("KALADA_FUNCTION_ESCAPE", frame.path);
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

function deliverTemporal<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "temporal-binary" }>,
  state: MachineState<R>,
): void {
  const value = state.value as RuntimeValue;
  if (isCallable(value) || (!isInstant(value) && !isDuration(value))) {
    fail("KALADA_TEMPORAL_TYPE_MISMATCH", [...frame.path, frame.phase]);
  }
  if (frame.phase === "left") {
    frame.phase = "right";
    frame.left = value;
    evaluate(frame.right, [...frame.path, "right"], state.environment, state);
    return;
  }
  state.stack.pop();
  const output = applyTemporalBinary(
    frame.expressionKind,
    frame.operator,
    frame.left as KaladaValue,
    value,
    [...frame.path, "right"],
  );
  deliver(output, state);
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
  if (callable.callable === "core") fail("KALADA_FUNCTION_ESCAPE", path);
  const closure = callable as UserClosure<R>;
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

import type { EvaluationFrame, Path } from "./evaluation-frames.js";
import { deliver, evaluate, fail, type MachineState, push } from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import type { RuntimeEnvironment, RuntimeValue } from "./runtime-values.js";
import type { KaladaV1Expression } from "./types.js";
import { isOption } from "./values.js";

type ControlExpression<R extends JsonValue> = Extract<
  KaladaV1Expression<R>,
  { kind: "conditional" | "option-coalesce" }
>;

export function enterControl<R extends JsonValue>(
  node: ControlExpression<R>,
  path: Path,
  state: MachineState<R>,
): void {
  if (node.kind === "conditional") {
    push(
      {
        kind: node.kind,
        phase: "condition",
        path,
        trueBranch: node.then,
        falseBranch: node.else,
        outer: state.environment,
      },
      [...path, "condition"],
      state,
    );
    evaluate(node.condition, [...path, "condition"], state.environment, state);
    return;
  }
  push(
    { kind: node.kind, phase: "option", path, fallback: node.fallback, outer: state.environment },
    [...path, "option"],
    state,
  );
  evaluate(node.option, [...path, "option"], state.environment, state);
}

export function deliverControl<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "conditional" | "option-coalesce" }>,
  state: MachineState<R>,
): void {
  if (frame.kind === "conditional") deliverConditional(frame, state);
  else deliverCoalesce(frame, state);
}

function deliverConditional<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "conditional" }>,
  state: MachineState<R>,
): void {
  if (frame.phase === "branch") {
    finish(frame.outer, state);
    return;
  }
  if (typeof state.value !== "boolean") fail("KALADA_OPERATOR_TYPE", [...frame.path, "condition"]);
  frame.phase = "branch";
  const key = state.value ? "then" : "else";
  const branch = state.value ? frame.trueBranch : frame.falseBranch;
  evaluate(branch, [...frame.path, key], frame.outer, state);
}

function deliverCoalesce<R extends JsonValue>(
  frame: Extract<EvaluationFrame<R>, { kind: "option-coalesce" }>,
  state: MachineState<R>,
): void {
  if (frame.phase === "fallback") {
    finish(frame.outer, state);
    return;
  }
  const option = state.value as RuntimeValue;
  if (!isOption(option)) fail("KALADA_OPTION_REQUIRED", [...frame.path, "option"]);
  if (option.variant === "some") {
    state.stack.pop();
    state.environment = frame.outer;
    deliver(option.value, state);
    return;
  }
  frame.phase = "fallback";
  evaluate(frame.fallback, [...frame.path, "fallback"], frame.outer, state);
}

function finish<R extends JsonValue>(
  environment: RuntimeEnvironment,
  state: MachineState<R>,
): void {
  state.stack.pop();
  state.environment = environment;
}

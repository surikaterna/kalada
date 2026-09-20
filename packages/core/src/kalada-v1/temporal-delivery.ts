import type { EvaluationFrame } from "./evaluation-frames.js";
import { deliver, evaluate, fail, type MachineState } from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import { isCallable, type RuntimeValue } from "./runtime-values.js";
import { isDuration, isInstant } from "./temporal.js";
import { applyTemporalBinary } from "./temporal-evaluation.js";
import type { KaladaValue } from "./values.js";

export function deliverTemporal<R extends JsonValue>(
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

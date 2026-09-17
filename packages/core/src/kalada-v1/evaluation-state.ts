import { KaladaFailure } from "./diagnostics.js";
import type { EvaluationFrame, EvaluationTask, Path } from "./evaluation-frames.js";
import type { JsonValue } from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import type { RuntimeEnvironment, RuntimeValue } from "./runtime-values.js";
import type { InstantValue } from "./temporal.js";
import type {
  KaladaV1DiagnosticContextFrame,
  KaladaV1Expression,
  KaladaV1FunctionCapture,
  KaladaV1Resolver,
} from "./types.js";

export interface MachineState<R extends JsonValue> {
  readonly resolve: KaladaV1Resolver<R>;
  readonly limits: ResolvedKaladaV1Limits;
  readonly captures: ReadonlyMap<string, readonly string[]>;
  readonly instant: InstantValue | undefined;
  readonly stack: EvaluationFrame<R>[];
  task: EvaluationTask<R> | null;
  value: RuntimeValue | null;
  environment: RuntimeEnvironment;
  steps: number;
  closures: number;
  captured: number;
  callDepth: number;
  collectionIterations: number;
}

export function evaluate<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  environment: RuntimeEnvironment,
  state: MachineState<R>,
): void {
  state.task = { node, path, environment };
}

export function deliver<R extends JsonValue>(value: RuntimeValue, state: MachineState<R>): void {
  state.value = value;
}

export function push<R extends JsonValue>(
  frame: EvaluationFrame<R>,
  failurePath: Path,
  state: MachineState<R>,
): void {
  ensureCapacity(failurePath, state);
  state.stack.push(frame);
}

export function ensureCapacity<R extends JsonValue>(path: Path, state: MachineState<R>): void {
  if (state.stack.length >= state.limits.maxContinuationFrames) {
    fail("KALADA_CONTINUATION_LIMIT", path);
  }
}

export function charge<R extends JsonValue>(path: Path, state: MachineState<R>): void {
  if (state.steps >= state.limits.maxEvaluationSteps) fail("KALADA_EVALUATION_LIMIT", path);
  state.steps += 1;
}

export function reserveCollectionIteration<R extends JsonValue>(
  path: Path,
  state: MachineState<R>,
): void {
  if (state.collectionIterations >= state.limits.maxCollectionIterations) {
    fail("KALADA_COLLECTION_LIMIT", path);
  }
  state.collectionIterations += 1;
  charge(path, state);
}

export function copyCaptures<R extends JsonValue>(
  path: Path,
  state: MachineState<R>,
): RuntimeEnvironment {
  const output = new Map<string, RuntimeValue>();
  for (const name of state.captures.get(pathKey(path)) ?? []) {
    if (state.captured >= state.limits.maxCapturedBindings) fail("KALADA_CAPTURE_LIMIT", path);
    charge(path, state);
    state.captured += 1;
    output.set(name, state.environment.get(name) as RuntimeValue);
  }
  return output;
}

export function reserveClosure<R extends JsonValue>(path: Path, state: MachineState<R>): void {
  if (state.closures >= state.limits.maxClosures) fail("KALADA_CLOSURE_LIMIT", path);
  charge(path, state);
  state.closures += 1;
}

export function captureMap(
  functions: readonly KaladaV1FunctionCapture[],
): ReadonlyMap<string, readonly string[]> {
  return new Map(functions.map((item) => [pathKey(item.path), item.captures]));
}

export function unwind<R extends JsonValue>(state: MachineState<R>): void {
  while (state.stack.length > 0) {
    const frame = state.stack.pop() as EvaluationFrame<R>;
    if (frame.kind === "binding" || frame.kind === "match") state.environment = frame.outer;
    if (frame.kind === "function-group-body") state.environment = frame.outer;
    if (frame.kind === "user-return") {
      state.environment = frame.caller;
      state.callDepth -= 1;
    }
    if (frame.kind === "core-iteration") state.callDepth -= 1;
  }
}

export function diagnosticContext<R extends JsonValue>(
  state: MachineState<R>,
): readonly KaladaV1DiagnosticContextFrame[] {
  const context: KaladaV1DiagnosticContextFrame[] = [];
  for (let index = state.stack.length - 1; index >= 0 && context.length < 32; index -= 1) {
    const frame = state.stack[index] as EvaluationFrame<R>;
    if (frame.kind === "user-return") {
      context.push({ kind: "function-call", name: frame.name, path: frame.path });
    }
    if (frame.kind === "core-iteration") {
      context.push({ kind: "core-call", name: frame.operator, path: frame.path });
    }
  }
  return context;
}

export function fail(code: ConstructorParameters<typeof KaladaFailure>[0], path: Path): never {
  throw new KaladaFailure(code, path);
}

function pathKey(path: Path): string {
  return JSON.stringify(path);
}

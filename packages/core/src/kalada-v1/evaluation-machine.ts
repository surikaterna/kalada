import { KaladaFailure } from "./diagnostics.js";
import { deliverFrame } from "./evaluation-delivery.js";
import type { EvaluationTask, Path } from "./evaluation-frames.js";
import { resolveReference } from "./evaluation-resolution.js";
import {
  captureMap,
  charge,
  copyCaptures,
  deliver,
  diagnosticContext,
  evaluate,
  fail,
  type MachineState,
  push,
  reserveClosure,
  unwind,
} from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import { enterOperator } from "./operator-evaluation.js";
import {
  closureFromExpression,
  closureFromMember,
  coreCallable,
  isCallable,
  type RecursiveEnvironment,
  type RuntimeValue,
  type UserClosure,
} from "./runtime-values.js";
import type { InstantValue } from "./temporal.js";
import { temporalLeaf } from "./temporal-evaluation.js";
import type { KaladaV1Expression, KaladaV1FunctionCapture, KaladaV1Resolver } from "./types.js";
import { type KaladaValue, Option } from "./values.js";

const FUNCTION_RUNTIME_DIAGNOSTICS = new Set([
  "KALADA_CAPTURE_LIMIT",
  "KALADA_NOT_CALLABLE",
  "KALADA_FUNCTION_ARITY",
  "KALADA_FUNCTION_TYPE_MISMATCH",
  "KALADA_CLOSURE_LIMIT",
  "KALADA_CALL_DEPTH_LIMIT",
  "KALADA_CONTINUATION_LIMIT",
  "KALADA_COLLECTION_TYPE_MISMATCH",
  "KALADA_COLLECTION_LIMIT",
  "KALADA_FUNCTION_ESCAPE",
]);

export function runEvaluation<R extends JsonValue>(
  expression: KaladaV1Expression<R>,
  resolve: KaladaV1Resolver<R>,
  limits: ResolvedKaladaV1Limits,
  functions: readonly KaladaV1FunctionCapture[],
  instant: InstantValue | undefined,
): KaladaValue {
  const environment = new Map<string, RuntimeValue>();
  const state: MachineState<R> = {
    resolve,
    limits,
    captures: captureMap(functions),
    instant,
    stack: [],
    task: { node: expression, path: ["expression"], environment },
    value: null,
    environment,
    steps: 0,
    closures: 0,
    captured: 0,
    callDepth: 0,
    collectionIterations: 0,
  };
  try {
    return runLoop(state);
  } catch (error) {
    if (!(error instanceof KaladaFailure) || error.context) throw error;
    const context = diagnosticContext(state);
    const includeContext = context.length > 0 || FUNCTION_RUNTIME_DIAGNOSTICS.has(error.code);
    unwind(state);
    throw new KaladaFailure(error.code, error.path, includeContext ? context : undefined);
  }
}

function runLoop<R extends JsonValue>(state: MachineState<R>): KaladaValue {
  while (true) {
    const result = advance(state);
    if (result !== undefined) return result;
  }
}

function advance<R extends JsonValue>(state: MachineState<R>): KaladaValue | undefined {
  if (state.task) {
    evaluateTask(state);
    return undefined;
  }
  if (state.stack.length > 0) {
    deliverFrame(state);
    return undefined;
  }
  const value = state.value as RuntimeValue;
  if (isCallable(value)) fail("KALADA_FUNCTION_ESCAPE", ["expression"]);
  return value;
}

function evaluateTask<R extends JsonValue>(state: MachineState<R>): void {
  const task = state.task as EvaluationTask<R>;
  state.task = null;
  state.environment = task.environment;
  charge(task.path, state);
  const { node, path } = task;
  switch (node.kind) {
    case "literal":
      deliver(node.value, state);
      break;
    case "ref":
      evaluateReference(node.ref, path, state);
      break;
    case "binding":
      enterBinding(node, path, state);
      break;
    case "field-access":
    case "optional-field-access":
    case "equality":
    case "ordered-comparison":
    case "membership":
      enterAddedExpression(node, path, state);
      break;
    case "option":
    case "result":
      enterConstructor(node, path, state);
      break;
    case "match":
      enterMatch(node, path, state);
      break;
    case "function":
      deliver(materializeFunction(node, path, state), state);
      break;
    case "function-group":
      enterGroup(node, path, state);
      break;
    case "call":
      enterCall(node, path, state);
      break;
    case "core-function":
      deliver(coreCallable(node.name), state);
      break;
    case "temporal-arithmetic":
    case "temporal-comparison":
      enterTemporal(node, path, state);
      break;
    default:
      deliver(temporalLeaf(node, path, state.instant), state);
  }
}

function enterAddedExpression<R extends JsonValue>(
  node: Extract<
    KaladaV1Expression<R>,
    {
      kind:
        | "field-access"
        | "optional-field-access"
        | "equality"
        | "ordered-comparison"
        | "membership";
    }
  >,
  path: Path,
  state: MachineState<R>,
): void {
  if (node.kind === "field-access" || node.kind === "optional-field-access") {
    enterFieldAccess(node, path, state);
  } else {
    enterOperator(node, path, state);
  }
}

function enterFieldAccess<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "field-access" | "optional-field-access" }>,
  path: Path,
  state: MachineState<R>,
): void {
  push({ kind: node.kind, phase: "target", path, field: node.field }, [...path, "target"], state);
  evaluate(node.target, [...path, "target"], state.environment, state);
}

function evaluateReference<R extends JsonValue>(
  reference: R,
  path: Path,
  state: MachineState<R>,
): void {
  if (typeof reference === "string" && state.environment.has(reference)) {
    deliver(state.environment.get(reference) as RuntimeValue, state);
    return;
  }
  deliver(resolveReference(reference, path, state.resolve, state.limits), state);
}

function enterBinding<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "binding" }>,
  path: Path,
  state: MachineState<R>,
): void {
  push(
    {
      kind: "binding",
      phase: "value",
      path,
      name: node.name,
      body: node.body,
      outer: state.environment,
    },
    [...path, "value"],
    state,
  );
  evaluate(node.value, [...path, "value"], state.environment, state);
}

function enterConstructor<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "option" | "result" }>,
  path: Path,
  state: MachineState<R>,
): void {
  if (node.kind === "option" && node.variant === "none") {
    deliver(Option.none(), state);
    return;
  }
  const type = node.kind === "option" ? "Option" : "Result";
  push(
    { kind: "constructor", phase: "payload", path, type, variant: node.variant },
    [...path, "value"],
    state,
  );
  evaluate(node.value, [...path, "value"], state.environment, state);
}

function enterMatch<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "match" }>,
  path: Path,
  state: MachineState<R>,
): void {
  push(
    {
      kind: "match",
      phase: "scrutinee",
      path,
      type: node.type,
      arms: node.arms,
      outer: state.environment,
      scrutinee: null,
      selected: null,
    },
    [...path, "value"],
    state,
  );
  evaluate(node.value, [...path, "value"], state.environment, state);
}

function enterTemporal<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "temporal-arithmetic" | "temporal-comparison" }>,
  path: Path,
  state: MachineState<R>,
): void {
  push(
    {
      kind: "temporal-binary",
      phase: "left",
      path,
      expressionKind: node.kind,
      operator: node.operator,
      right: node.right,
      left: null,
    },
    [...path, "left"],
    state,
  );
  evaluate(node.left, [...path, "left"], state.environment, state);
}

function enterCall<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "call" }>,
  path: Path,
  state: MachineState<R>,
): void {
  push(
    { kind: "call-callee", phase: "callee", path, arguments: node.arguments },
    [...path, "callee"],
    state,
  );
  evaluate(node.callee, [...path, "callee"], state.environment, state);
}

function enterGroup<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function-group" }>,
  path: Path,
  state: MachineState<R>,
): void {
  const names = Object.freeze(node.functions.map((item) => item.name));
  const closures: UserClosure<R>[] = [];
  const recursive = { names, closures } as RecursiveEnvironment<R>;
  node.functions.forEach((member, index) => {
    const memberPath = [...path, "functions", index];
    reserveClosure(memberPath, state);
    const captured = copyCaptures(memberPath, state);
    closures.push(closureFromMember(member, memberPath, captured, recursive));
  });
  Object.freeze(closures);
  Object.freeze(recursive);
  const group = new Map(state.environment);
  names.forEach((name, index) => {
    group.set(name, closures[index] as UserClosure<R>);
  });
  push(
    {
      kind: "function-group-body",
      phase: "body",
      path,
      body: node.body,
      outer: state.environment,
      group,
    },
    [...path, "body"],
    state,
  );
  evaluate(node.body, [...path, "body"], group, state);
}

function materializeFunction<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function" }>,
  path: Path,
  state: MachineState<R>,
): UserClosure<R> {
  reserveClosure(path, state);
  const captures = copyCaptures(path, state);
  return closureFromExpression(node, path, captures);
}

import {
  type CompiledKaladaV1Program,
  type InstantValue,
  isInstant,
  type JsonValue,
  type KaladaV1Program,
  type KaladaV1Resolution,
} from "@kalada/core";
import { frozenRecord } from "./canonical-output.js";
import { ProjectionFailure, projectionFailure } from "./diagnostics.js";
import { OutputAccounting, type OutputEntry, type OutputTree } from "./output-accounting.js";
import type {
  ProjectionClock,
  ProjectionEvaluationInputs,
  ProjectionEvaluationOutcome,
  ProjectionNode,
  ProjectionPath,
  ProjectionProgram,
  ProjectionResolver,
  ProjectionV1Limits,
} from "./types.js";
import { OMIT, valueOutput } from "./value-output.js";

type Programs = WeakMap<KaladaV1Program<string>, CompiledKaladaV1Program<string>>;
type Emission = OutputTree | typeof OMIT;

interface EvaluationState {
  readonly resolve: ProjectionResolver;
  readonly scopes: ReadonlyMap<string, JsonValue>[];
  readonly instant?: InstantValue;
  readonly programs: Programs;
  readonly limits: Readonly<ProjectionV1Limits>;
  readonly output: OutputAccounting;
  invocations: number;
  iterations: number;
}

export function evaluateProjection(
  projection: ProjectionProgram,
  programs: Programs,
  limits: Readonly<ProjectionV1Limits>,
): (
  resolve: ProjectionResolver,
  inputs?: ProjectionEvaluationInputs,
) => ProjectionEvaluationOutcome {
  return (resolve, inputs = {}) => {
    try {
      return run(projection, programs, limits, resolve, inputs.instant);
    } catch {
      return projectionFailure("PROJECTION_INVALID_INPUT", []);
    }
  };
}

export function evaluateProjectionWithClock(
  projection: ProjectionProgram,
  programs: Programs,
  limits: Readonly<ProjectionV1Limits>,
): (resolve: ProjectionResolver, clock: ProjectionClock) => ProjectionEvaluationOutcome {
  return (resolve, clock) => {
    const instant = sampleClock(clock);
    if (!instant) return projectionFailure("PROJECTION_CLOCK_ERROR", ["clock"]);
    return run(projection, programs, limits, resolve, instant);
  };
}

function run(
  projection: ProjectionProgram,
  programs: Programs,
  limits: Readonly<ProjectionV1Limits>,
  resolve: ProjectionResolver,
  instant?: InstantValue,
): ProjectionEvaluationOutcome {
  const state: EvaluationState = {
    resolve,
    scopes: [],
    instant,
    programs,
    limits,
    output: new OutputAccounting(limits),
    invocations: 0,
    iterations: 0,
  };
  try {
    const result = evaluateNode(projection.root, ["root"], 0, state);
    if (result === OMIT) return Object.freeze({ ok: true, omitted: true });
    state.output.failIfPending();
    return Object.freeze({ ok: true, value: result.value });
  } catch (error) {
    const failure =
      error instanceof ProjectionFailure
        ? error
        : new ProjectionFailure("PROJECTION_INVALID_INPUT", []);
    return projectionFailure(failure.code, failure.path, failure.cause);
  }
}

function evaluateNode(
  node: ProjectionNode,
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): Emission {
  if (node.kind === "value")
    return evaluateValue(node.expression, [...path, "expression"], depth, state);
  if (node.kind === "object") return evaluateObject(node.entries, path, depth, state);
  if (node.kind === "array") return evaluateArray(node.items, path, depth, state);
  if (node.kind === "if") return evaluateIf(node, path, depth, state);
  if (node.kind === "map") return evaluateMap(node, path, depth, state);
  throw new ProjectionFailure("PROJECTION_INVALID_INPUT", path);
}

function evaluateValue(
  expression: KaladaV1Program<string>,
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): Emission {
  const value = evaluateExpression(expression, path, state);
  let output: Emission;
  try {
    output = valueOutput(value, path);
  } catch {
    throw new ProjectionFailure("PROJECTION_VALUE_TYPE", path);
  }
  if (output !== OMIT) state.output.chargeTree(output, depth);
  return output;
}

function evaluateObject(
  entries: readonly { readonly key: string; readonly value: ProjectionNode }[],
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): OutputTree {
  const containerCheckpoint = state.output.checkpoint();
  state.output.startContainer(depth, path, "{");
  state.output.failIfChanged(containerCheckpoint);
  const emitted: OutputEntry[] = [];
  for (const [index, entry] of entries.entries()) {
    const keyPath = [...path, "entries", index, "key"];
    const checkpoint = state.output.checkpoint();
    if (emitted.length > 0) state.output.token(",", keyPath);
    state.output.token(JSON.stringify(entry.key), keyPath);
    state.output.token(":", keyPath);
    const child = evaluateNode(entry.value, [...path, "entries", index, "value"], depth + 1, state);
    if (child === OMIT) state.output.rollback(checkpoint);
    else {
      emitted.push(Object.freeze({ key: entry.key, keyPath, output: child }));
      state.output.failIfChanged(checkpoint);
    }
  }
  state.output.token("}", path);
  return Object.freeze({ value: makeRecord(emitted), path, entries: Object.freeze(emitted) });
}

function evaluateArray(
  items: readonly ProjectionNode[],
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): OutputTree {
  const containerCheckpoint = state.output.checkpoint();
  state.output.startContainer(depth, path, "[");
  state.output.failIfChanged(containerCheckpoint);
  const emitted: OutputTree[] = [];
  for (const [index, item] of items.entries()) {
    const itemPath = [...path, "items", index];
    const checkpoint = state.output.checkpoint();
    if (emitted.length > 0) state.output.token(",", itemPath);
    const child = evaluateNode(item, itemPath, depth + 1, state);
    if (child === OMIT) state.output.rollback(checkpoint);
    else {
      emitted.push(child);
      state.output.failIfChanged(checkpoint);
    }
  }
  state.output.token("]", path);
  const value = Object.freeze(emitted.map((item) => item.value)) as OutputTree["value"];
  return Object.freeze({ value, path, items: Object.freeze(emitted) });
}

function evaluateIf(
  node: Extract<ProjectionNode, { kind: "if" }>,
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): Emission {
  const conditionPath = [...path, "condition"];
  const condition = evaluateExpression(node.condition, conditionPath, state);
  if (typeof condition !== "boolean")
    throw new ProjectionFailure("PROJECTION_CONDITION_TYPE", conditionPath);
  if (condition) return evaluateNode(node.then, [...path, "then"], depth, state);
  if (!node.else) return OMIT;
  return evaluateNode(node.else, [...path, "else"], depth, state);
}

function evaluateMap(
  node: Extract<ProjectionNode, { kind: "map" }>,
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): OutputTree {
  const collectionPath = [...path, "collection"];
  const collection = evaluateExpression(node.collection, collectionPath, state);
  if (!Array.isArray(collection)) {
    throw new ProjectionFailure("PROJECTION_COLLECTION_TYPE", collectionPath);
  }
  if (collection.length > state.limits.maxCollectionLength) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", collectionPath);
  }
  const containerCheckpoint = state.output.checkpoint();
  state.output.startContainer(depth, path, "[");
  state.output.failIfChanged(containerCheckpoint);
  const emitted: OutputTree[] = [];
  for (const [index, item] of collection.entries()) {
    const itemPath = [...path, "body", index];
    reserveIteration(itemPath, state);
    const checkpoint = state.output.checkpoint();
    if (emitted.length > 0) state.output.token(",", itemPath);
    const child = evaluateMapBody(node, item, index, itemPath, depth, state);
    if (child === OMIT) state.output.rollback(checkpoint);
    else {
      emitted.push(child);
      state.output.failIfChanged(checkpoint);
    }
  }
  state.output.token("]", path);
  const value = Object.freeze(emitted.map((item) => item.value)) as OutputTree["value"];
  return Object.freeze({ value, path, items: Object.freeze(emitted) });
}

function evaluateMapBody(
  node: Extract<ProjectionNode, { kind: "map" }>,
  item: JsonValue,
  index: number,
  path: ProjectionPath,
  depth: number,
  state: EvaluationState,
): Emission {
  state.scopes.push(
    new Map([
      [node.item, item],
      [node.index, index],
    ]),
  );
  try {
    return evaluateNode(node.body, path, depth + 1, state);
  } finally {
    state.scopes.pop();
  }
}

function reserveIteration(path: ProjectionPath, state: EvaluationState): void {
  state.iterations += 1;
  if (state.iterations > state.limits.maxCollectionIterations) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", path);
  }
}

function evaluateExpression(
  expression: KaladaV1Program<string>,
  path: ProjectionPath,
  state: EvaluationState,
) {
  state.invocations += 1;
  if (state.invocations > state.limits.maxExpressionInvocations) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", path);
  }
  const compiled = state.programs.get(expression);
  if (!compiled) throw new ProjectionFailure("PROJECTION_INVALID_INPUT", path);
  const outcome = compiled.evaluate(
    (reference) => resolveReference(reference, state),
    state.instant ? { instant: state.instant } : undefined,
  );
  if (!outcome.ok) throw new ProjectionFailure("PROJECTION_CORE_ERROR", path, outcome.diagnostic);
  return outcome.value;
}

function resolveReference(reference: string, state: EvaluationState): KaladaV1Resolution {
  for (let index = state.scopes.length - 1; index >= 0; index -= 1) {
    const scope = state.scopes[index];
    if (scope?.has(reference)) return { found: true, value: scope.get(reference) as JsonValue };
  }
  return state.resolve(reference);
}

function makeRecord(entries: readonly OutputEntry[]) {
  const fields: Record<string, unknown> = Object.create(null);
  for (const entry of entries) fields[entry.key] = entry.output.value;
  return frozenRecord(fields) as OutputTree["value"];
}

function sampleClock(clock: ProjectionClock): InstantValue | undefined {
  let sample: unknown;
  try {
    sample = clock();
    if (consumePromise(sample) || !isInstant(sample)) return undefined;
  } catch {
    return undefined;
  }
  return sample;
}

function consumePromise(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  try {
    void Reflect.apply(Promise.prototype.then, value, [undefined, () => undefined]);
    return true;
  } catch {
    return false;
  }
}

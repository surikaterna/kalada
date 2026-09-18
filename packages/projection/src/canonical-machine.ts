import {
  compileKaladaV1Program,
  type KaladaV1FunctionLimits,
  type KaladaV1Limits,
  type KaladaV1Program,
} from "@kalada/core/kalada-v1";
import { ProjectionFailure } from "./diagnostics.js";
import { inspectArray, inspectRecord, invalid } from "./inspect.js";
import { resolveProjectionLimits } from "./resolve-limits.js";
import type {
  ProjectionNode,
  ProjectionObjectEntry,
  ProjectionPath,
  ProjectionProgram,
  ProjectionV1Limits,
  ProjectionV1Options,
} from "./types.js";

type CoreLimits = Partial<KaladaV1Limits & KaladaV1FunctionLimits>;
type Assign = (value: ProjectionNode) => void;
type Work =
  | {
      readonly action: "node";
      readonly input: unknown;
      readonly path: ProjectionPath;
      readonly depth: number;
      readonly assign: Assign;
    }
  | { readonly action: "finish"; readonly input: object; readonly finish: () => void };
interface State {
  readonly limits: Readonly<ProjectionV1Limits>;
  readonly coreLimits: CoreLimits | undefined;
  readonly active: WeakSet<object>;
  readonly dependencies: string[];
  readonly seenDependencies: Set<string>;
  nodes: number;
}

const NODE_FIELDS = [
  "expression",
  "entries",
  "items",
  "condition",
  "then",
  "else",
  "collection",
  "item",
  "index",
  "body",
] as const;

export function canonicalProjection(
  input: unknown,
  options: ProjectionV1Options,
): { readonly projection: ProjectionProgram; readonly dependencies: readonly string[] } {
  const envelope = inspectRecord(input, [], ["format", "version", "profile", "root"]);
  checkEnvelope(envelope);
  const optionFields = inspectRecord(options, [], [], ["limits", "coreLimits"]);
  const state: State = {
    limits: resolveProjectionLimits(optionFields.limits),
    coreLimits: optionFields.coreLimits as CoreLimits | undefined,
    active: new WeakSet(),
    dependencies: [],
    seenDependencies: new Set(),
    nodes: 0,
  };
  let root: ProjectionNode | undefined;
  const stack: Work[] = [
    {
      action: "node",
      input: envelope.root,
      path: ["root"],
      depth: 0,
      assign: (value) => (root = value),
    },
  ];
  while (stack.length > 0) {
    const work = stack.pop();
    if (!work) break;
    if (work.action === "finish") {
      work.finish();
      state.active.delete(work.input);
    } else {
      enterNode(work, stack, state);
    }
  }
  if (!root) invalid(["root"]);
  const projection = frozenRecord({
    format: "kalada-projection",
    version: 1,
    profile: "projection-v1",
    root,
  }) as unknown as ProjectionProgram;
  return Object.freeze({ projection, dependencies: Object.freeze(state.dependencies) });
}

function checkEnvelope(fields: Record<string, unknown>): void {
  if (fields.format !== "kalada-projection") invalid(["format"]);
  if (fields.version !== 1) invalid(["version"]);
  if (fields.profile !== "projection-v1") invalid(["profile"]);
}

function enterNode(work: Extract<Work, { action: "node" }>, stack: Work[], state: State): void {
  countNode(work, state);
  if (typeof work.input !== "object" || work.input === null || state.active.has(work.input)) {
    invalid(work.path);
  }
  const input = work.input as object;
  const raw = inspectRecord(input, work.path, ["kind"], NODE_FIELDS);
  state.active.add(input);
  try {
    switch (raw.kind) {
      case "value":
        enterValue(raw, work, stack, state, input);
        break;
      case "object":
        enterObject(raw, work, stack, state, input);
        break;
      case "array":
        enterArray(raw, work, stack, state, input);
        break;
      case "if":
        enterIf(raw, work, stack, state, input);
        break;
      case "map":
        enterMap(raw, work, stack, state, input);
        break;
      default:
        invalid([...work.path, "kind"]);
    }
  } catch (error) {
    state.active.delete(input);
    throw error;
  }
}

function countNode(work: Extract<Work, { action: "node" }>, state: State): void {
  if (work.depth > state.limits.maxProjectionDepth) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", work.path);
  }
  state.nodes += 1;
  if (state.nodes > state.limits.maxProjectionNodes) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", work.path);
  }
}

function enterValue(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "expression"]);
  const expression = compileExpression(raw.expression, [...work.path, "expression"], state);
  stack.push(
    finish(input, () =>
      work.assign(frozenRecord({ kind: "value", expression }) as unknown as ProjectionNode),
    ),
  );
}

function enterObject(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "entries"]);
  const path = [...work.path, "entries"];
  const source = inspectArray(raw.entries, path);
  if (source.length > state.limits.maxObjectEntries) limit(path);
  const entries = prepareEntries(source, path, state);
  const values: ProjectionNode[] = [];
  stack.push(finish(input, () => work.assign(makeObjectNode(entries, values))));
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    stack.push({
      action: "node",
      input: entry.input,
      path: [...path, index, "value"],
      depth: work.depth + 1,
      assign: (value) => (values[index] = value),
    });
  }
}

interface PreparedEntry {
  readonly key: string;
  readonly input: unknown;
}

function prepareEntries(
  source: readonly unknown[],
  path: ProjectionPath,
  state: State,
): readonly PreparedEntry[] {
  const seen = new Set<string>();
  return source.map((input, index) => {
    const entryPath = [...path, index];
    const raw = inspectRecord(input, entryPath, ["key", "value"]);
    if (typeof raw.key !== "string" || raw.key.length === 0) invalid([...entryPath, "key"]);
    if (codePointLengthAbove(raw.key, state.limits.maxKeyLength)) limit([...entryPath, "key"]);
    if (isUnsafeKey(raw.key))
      throw new ProjectionFailure("PROJECTION_UNSAFE_KEY", [...entryPath, "key"]);
    if (seen.has(raw.key))
      throw new ProjectionFailure("PROJECTION_DUPLICATE_KEY", [...entryPath, "key"]);
    seen.add(raw.key);
    return Object.freeze({ key: raw.key, input: raw.value });
  });
}

function makeObjectNode(
  entries: readonly PreparedEntry[],
  values: readonly ProjectionNode[],
): ProjectionNode {
  const output = entries.map(
    (entry, index) =>
      frozenRecord({ key: entry.key, value: values[index] }) as unknown as ProjectionObjectEntry,
  );
  return frozenRecord({
    kind: "object",
    entries: Object.freeze(output),
  }) as unknown as ProjectionNode;
}

function enterArray(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "items"]);
  const path = [...work.path, "items"];
  const source = inspectArray(raw.items, path);
  if (source.length > state.limits.maxArrayItems) limit(path);
  const items: ProjectionNode[] = [];
  stack.push(
    finish(input, () =>
      work.assign(
        frozenRecord({ kind: "array", items: Object.freeze(items) }) as unknown as ProjectionNode,
      ),
    ),
  );
  pushChildren(source, path, work.depth, items, stack);
}

function enterIf(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "condition", "then"], ["else"]);
  const condition = compileExpression(raw.condition, [...work.path, "condition"], state);
  let thenNode: ProjectionNode | undefined;
  let elseNode: ProjectionNode | undefined;
  stack.push(
    finish(input, () => {
      if (!thenNode) invalid([...work.path, "then"]);
      work.assign(
        frozenRecord({
          kind: "if",
          condition,
          // biome-ignore lint/suspicious/noThenProperty: ADR-0004 fixes this exact data key.
          then: thenNode,
          ...(elseNode ? { else: elseNode } : {}),
        }) as unknown as ProjectionNode,
      );
    }),
  );
  if ("else" in raw)
    stack.push(child(raw.else, [...work.path, "else"], work.depth, (value) => (elseNode = value)));
  stack.push(child(raw.then, [...work.path, "then"], work.depth, (value) => (thenNode = value)));
}

function enterMap(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "collection", "item", "index", "body"]);
  const collection = compileExpression(raw.collection, [...work.path, "collection"], state);
  const item = bindingName(raw.item, [...work.path, "item"], state.limits.maxNameLength);
  const index = bindingName(raw.index, [...work.path, "index"], state.limits.maxNameLength);
  if (item === index) invalid([...work.path, "index"]);
  let body: ProjectionNode | undefined;
  stack.push(
    finish(input, () => {
      if (!body) invalid([...work.path, "body"]);
      work.assign(
        frozenRecord({ kind: "map", collection, item, index, body }) as unknown as ProjectionNode,
      );
    }),
  );
  stack.push(child(raw.body, [...work.path, "body"], work.depth, (value) => (body = value)));
}

function compileExpression(
  input: unknown,
  path: ProjectionPath,
  state: State,
): KaladaV1Program<string> {
  let outcome: ReturnType<typeof compileKaladaV1Program<string>>;
  try {
    outcome = compileKaladaV1Program<string>(input, { limits: state.coreLimits });
  } catch {
    invalid(path);
  }
  if (!outcome.ok) throw new ProjectionFailure("PROJECTION_CORE_ERROR", path, outcome.diagnostic);
  for (const dependency of outcome.value.dependencies) {
    if (!state.seenDependencies.has(dependency)) {
      state.seenDependencies.add(dependency);
      state.dependencies.push(dependency);
    }
  }
  return outcome.value.program;
}

function exact(
  raw: Record<string, unknown>,
  path: ProjectionPath,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) invalid(path);
  for (const key of required) if (!(key in raw)) invalid([...path, key]);
}

function bindingName(input: unknown, path: ProjectionPath, maximum: number): string {
  if (typeof input !== "string" || input.length === 0) invalid(path);
  if (codePointLengthAbove(input, maximum)) limit(path);
  return input;
}

function codePointLengthAbove(value: string, maximum: number): boolean {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > maximum) return true;
  }
  return false;
}

function isUnsafeKey(key: string): boolean {
  if (key === "__proto__" || key === "prototype" || key === "constructor") return true;
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) return false;
  return Number(key) <= 4_294_967_294;
}

function pushChildren(
  source: readonly unknown[],
  path: ProjectionPath,
  depth: number,
  output: ProjectionNode[],
  stack: Work[],
): void {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    stack.push(child(source[index], [...path, index], depth, (value) => (output[index] = value)));
  }
}

function child(input: unknown, path: ProjectionPath, depth: number, assign: Assign): Work {
  return { action: "node", input, path, depth: depth + 1, assign };
}

function finish(input: object, operation: () => void): Work {
  return { action: "finish", input, finish: operation };
}

function limit(path: ProjectionPath): never {
  throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", path);
}

function frozenRecord(fields: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const output = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields))
    Object.defineProperty(output, key, { enumerable: true, value });
  return Object.freeze(output);
}

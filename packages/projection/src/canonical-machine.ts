import type {
  CompiledKaladaV1Program,
  KaladaV1FunctionLimits,
  KaladaV1Limits,
  KaladaV1Program,
} from "@kalada/core/kalada-v1";
import { compileProjectionExpression } from "./canonical-expression.js";
import { type PreparedProjectionEntry, prepareProjectionEntry } from "./canonical-object.js";
import { frozenRecord } from "./canonical-output.js";
import { bindingName, exact } from "./canonical-shape.js";
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
      readonly scope: ReadonlySet<string>;
      readonly assign: Assign;
    }
  | { readonly action: "finish"; readonly input: object; readonly finish: () => void }
  | { readonly action: "task"; readonly run: () => void };
interface State {
  readonly limits: Readonly<ProjectionV1Limits>;
  readonly coreLimits: CoreLimits | undefined;
  readonly active: WeakSet<object>;
  readonly dependencies: string[];
  readonly seenDependencies: Set<string>;
  readonly programs: WeakMap<KaladaV1Program<string>, CompiledKaladaV1Program<string>>;
  nodes: number;
}
interface CanonicalProjectionResult {
  readonly projection: ProjectionProgram;
  readonly dependencies: readonly string[];
  readonly limits: Readonly<ProjectionV1Limits>;
  readonly programs: WeakMap<KaladaV1Program<string>, CompiledKaladaV1Program<string>>;
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
): CanonicalProjectionResult {
  const envelope = inspectRecord(input, [], ["format", "version", "profile", "root"]);
  checkEnvelope(envelope);
  const optionFields = inspectRecord(options, [], [], ["limits", "coreLimits"]);
  const state = createState(optionFields);
  let root: ProjectionNode | undefined;
  const stack: Work[] = [
    {
      action: "node",
      input: envelope.root,
      path: ["root"],
      depth: 0,
      scope: new Set(),
      assign: (value) => (root = value),
    },
  ];
  while (stack.length > 0) {
    const work = stack.pop();
    if (!work) break;
    if (work.action === "task") {
      work.run();
    } else if (work.action === "finish") {
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
  return Object.freeze({
    projection,
    dependencies: Object.freeze(state.dependencies),
    limits: state.limits,
    programs: state.programs,
  });
}

function createState(optionFields: Record<string, unknown>): State {
  return {
    limits: resolveProjectionLimits(optionFields.limits),
    coreLimits: optionFields.coreLimits as CoreLimits | undefined,
    active: new WeakSet(),
    dependencies: [],
    seenDependencies: new Set(),
    programs: new WeakMap(),
    nodes: 0,
  };
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
  const expression = compileProjectionExpression(
    raw.expression,
    [...work.path, "expression"],
    work.scope,
    state,
  );
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
  const entries: ProjectionObjectEntry[] = [];
  const seen = new Set<string>();
  stack.push(finish(input, () => work.assign(makeObjectNode(entries))));
  stack.push(task(() => processEntry(0, source, path, work, entries, seen, stack, state)));
}

function processEntry(
  index: number,
  source: readonly unknown[],
  path: ProjectionPath,
  work: Extract<Work, { action: "node" }>,
  output: ProjectionObjectEntry[],
  seen: Set<string>,
  stack: Work[],
  state: State,
): void {
  if (index >= source.length) return;
  const entry = prepareProjectionEntry(
    source[index],
    [...path, index],
    state.limits.maxKeyLength,
    seen,
  );
  stack.push(task(() => processEntry(index + 1, source, path, work, output, seen, stack, state)));
  stack.push(entryChild(entry, index, path, work, output));
}

function entryChild(
  entry: PreparedProjectionEntry,
  index: number,
  path: ProjectionPath,
  work: Extract<Work, { action: "node" }>,
  output: ProjectionObjectEntry[],
): Work {
  return child(entry.input, [...path, index, "value"], work.depth, work.scope, (value) => {
    output[index] = frozenRecord({ key: entry.key, value }) as unknown as ProjectionObjectEntry;
  });
}

function makeObjectNode(entries: readonly ProjectionObjectEntry[]): ProjectionNode {
  return frozenRecord({
    kind: "object",
    entries: Object.freeze(entries),
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
  pushChildren(source, path, work.depth, work.scope, items, stack);
}

function enterIf(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "condition", "then"], ["else"]);
  const condition = compileProjectionExpression(
    raw.condition,
    [...work.path, "condition"],
    work.scope,
    state,
  );
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
    stack.push(
      child(
        raw.else,
        [...work.path, "else"],
        work.depth,
        work.scope,
        (value) => (elseNode = value),
      ),
    );
  stack.push(
    child(raw.then, [...work.path, "then"], work.depth, work.scope, (value) => (thenNode = value)),
  );
}

function enterMap(
  raw: Record<string, unknown>,
  work: Extract<Work, { action: "node" }>,
  stack: Work[],
  state: State,
  input: object,
): void {
  exact(raw, work.path, ["kind", "collection", "item", "index", "body"]);
  const collection = compileProjectionExpression(
    raw.collection,
    [...work.path, "collection"],
    work.scope,
    state,
  );
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
  const bodyScope = new Set(work.scope);
  bodyScope.add(item);
  bodyScope.add(index);
  stack.push(
    child(raw.body, [...work.path, "body"], work.depth, bodyScope, (value) => (body = value)),
  );
}

function pushChildren(
  source: readonly unknown[],
  path: ProjectionPath,
  depth: number,
  scope: ReadonlySet<string>,
  output: ProjectionNode[],
  stack: Work[],
): void {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    stack.push(
      child(source[index], [...path, index], depth, scope, (value) => (output[index] = value)),
    );
  }
}

function child(
  input: unknown,
  path: ProjectionPath,
  depth: number,
  scope: ReadonlySet<string>,
  assign: Assign,
): Work {
  return { action: "node", input, path, depth: depth + 1, scope, assign };
}

function finish(input: object, operation: () => void): Work {
  return { action: "finish", input, finish: operation };
}

function task(operation: () => void): Work {
  return { action: "task", run: operation };
}

function limit(path: ProjectionPath): never {
  throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", path);
}

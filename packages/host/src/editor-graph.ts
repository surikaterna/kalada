import { markReferenceCycles } from "./editor-cycle.js";
import type {
  EditorEdge,
  EditorGraph,
  EditorGraphDefinition,
  EditorGraphInput,
  EditorGraphLimits,
  EditorGraphRoot,
  EditorNode,
  EditorPropertyEdge,
  EditorReferenceNode,
  EditorUnknownCode,
  HostPath,
} from "./editor-types.js";
import { readOwnDataRecord } from "./serializable.js";

export const DEFAULT_EDITOR_GRAPH_LIMITS: EditorGraphLimits = Object.freeze({
  maxDepth: 32,
  maxNodes: 2_048,
  maxEdges: 8_192,
});

interface GraphState {
  readonly limits: EditorGraphLimits;
  readonly nodes: EditorNode[];
  readonly seen: WeakMap<object, string>;
  readonly active: Set<string>;
  readonly references: { index: number; bindingId: string }[];
  edges: number;
  limitNodeId?: string;
}

export function createEditorGraph(
  inputs: readonly EditorGraphInput[],
  requestedLimits: Partial<EditorGraphLimits> = {},
): EditorGraph {
  let limits = DEFAULT_EDITOR_GRAPH_LIMITS;
  try {
    limits = normalizeLimits(requestedLimits);
    return buildGraph(inputs, limits);
  } catch {
    return invalidGraph(limits);
  }
}

function buildGraph(inputs: readonly EditorGraphInput[], limits: EditorGraphLimits): EditorGraph {
  const state = createState(limits);
  const roots: EditorGraphRoot[] = [];
  const definitions: EditorGraphDefinition[] = [];
  const targets = new Map<string, Map<string, string>>();
  for (const input of inputs) addDocument(input, state, roots, definitions, targets);
  resolveReferences(state, targets);
  markReferenceCycles(state.nodes, state.references);
  const nodes = state.nodes.map((node) => Object.freeze(node));
  return Object.freeze({
    format: "kalada-editor-graph-v1",
    nodeIdScope: "document-local",
    limits,
    roots: Object.freeze(roots),
    nodes: Object.freeze(nodes),
    definitions: Object.freeze(definitions),
  });
}

function invalidGraph(limits: EditorGraphLimits): EditorGraph {
  const path = Object.freeze([]);
  const node = Object.freeze(unknownNode("n0", path, "invalid-shape"));
  const root = Object.freeze({ ...edge("n0", path, false), bindingId: "<invalid>" });
  return Object.freeze({
    format: "kalada-editor-graph-v1",
    nodeIdScope: "document-local",
    limits,
    roots: Object.freeze([root]),
    nodes: Object.freeze([node]),
    definitions: Object.freeze([]),
  });
}

function createState(limits: EditorGraphLimits): GraphState {
  return {
    limits,
    nodes: [],
    seen: new WeakMap(),
    active: new Set(),
    references: [],
    edges: 0,
  };
}

function addDocument(
  input: EditorGraphInput,
  state: GraphState,
  roots: EditorGraphRoot[],
  definitions: EditorGraphDefinition[],
  targets: Map<string, Map<string, string>>,
): void {
  const path = freezePath(input.path);
  const root = addNode(input.document.root, path, 0, input.bindingId, state);
  roots.push(Object.freeze({ ...root, bindingId: input.bindingId }));
  const bindingTargets = new Map<string, string>();
  targets.set(input.bindingId, bindingTargets);
  for (const definition of input.document.definitions ?? []) {
    addDefinition(input, definition, state, definitions, bindingTargets);
  }
}

function addDefinition(
  input: EditorGraphInput,
  definition: { readonly name: string; readonly shape: unknown },
  state: GraphState,
  definitions: EditorGraphDefinition[],
  targets: Map<string, string>,
): void {
  const path = freezePath([...input.path, "$defs", definition.name]);
  const edge = addNode(definition.shape, path, 0, input.bindingId, state);
  const item = Object.freeze({
    bindingId: input.bindingId,
    name: definition.name,
    nodeId: edge.nodeId,
    path,
  });
  definitions.push(item);
  if (!targets.has(definition.name)) targets.set(definition.name, edge.nodeId);
}

function addNode(
  shape: unknown,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorEdge {
  if (depth > state.limits.maxDepth) return unknownEdge("depth-limit", path, state);
  if (typeof shape !== "object" || shape === null || Array.isArray(shape)) {
    return unknownEdge("invalid-shape", path, state);
  }
  const prior = state.seen.get(shape);
  if (prior) return edge(prior, path, state.active.has(prior));
  if (state.nodes.length >= state.limits.maxNodes - 1)
    return unknownEdge("node-limit", path, state);
  const id = `n${state.nodes.length}`;
  state.seen.set(shape, id);
  state.active.add(id);
  const index = state.nodes.length;
  state.nodes.push(unknownNode(id, path, "invalid-shape"));
  state.nodes[index] = readNode(shape, id, path, depth, bindingId, state);
  state.active.delete(id);
  return edge(id, path, false);
}

function readNode(
  shape: object,
  id: string,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorNode {
  const inspected = readOwnDataRecord(shape, state.limits.maxEdges);
  if (!inspected.ok) return unknownNode(id, path, "invalid-shape");
  const record = inspected.value;
  if (record.kind === "scalar") return scalarNode(record, id, path);
  if (record.kind === "unknown") return declaredUnknownNode(record, id, path);
  if (record.kind === "object") return objectNode(record, id, path, depth, bindingId, state);
  if (record.kind === "array") return arrayNode(record, id, path, depth, bindingId, state);
  if (record.kind === "tuple") return tupleNode(record, id, path, depth, bindingId, state);
  if (record.kind === "union") return unionNode(record, id, path, depth, bindingId, state);
  if (record.kind === "reference") return referenceNode(record, id, path, bindingId, state);
  return unknownNode(id, path, "unsupported-shape");
}

function scalarNode(record: Record<string, unknown>, id: string, path: HostPath): EditorNode {
  const names = ["null", "boolean", "number", "string", "json", "instant", "duration"];
  if (typeof record.name !== "string" || !names.includes(record.name)) {
    return unknownNode(id, path, "invalid-shape");
  }
  return { id, path, kind: "scalar", name: record.name as never, ...available() };
}

function declaredUnknownNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode {
  const reason = typeof record.reason === "string" ? record.reason.slice(0, 256) : undefined;
  return {
    ...unknownNode(id, path, "unsupported-shape"),
    ...(reason === undefined ? {} : { reason }),
  };
}

function objectNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorNode {
  if (!Array.isArray(record.properties)) return unknownNode(id, path, "invalid-shape");
  const properties: EditorPropertyEdge[] = [];
  for (let index = 0; index < record.properties.length; index += 1) {
    properties.push(propertyEdge(record.properties[index], index, path, depth, bindingId, state));
  }
  return { id, path, kind: "object", properties: Object.freeze(properties), ...available() };
}

function propertyEdge(
  input: unknown,
  index: number,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorPropertyEdge {
  const inspected = readOwnDataRecord(input, 4);
  const record = inspected.ok ? inspected.value : Object.create(null);
  const name = typeof record.name === "string" ? record.name : `<invalid:${index}>`;
  const childPath = freezePath([...path, name]);
  const child = childEdge(record.shape, childPath, depth, bindingId, state);
  return Object.freeze({ ...child, name, required: record.required === true });
}

function arrayNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorNode {
  const childPath = freezePath([...path, "[]"]);
  const element = childEdge(record.element, childPath, depth, bindingId, state);
  return { id, path, kind: "array", element, ...available() };
}

function tupleNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorNode {
  if (!Array.isArray(record.items)) return unknownNode(id, path, "invalid-shape");
  const items = record.items.map((item, index) =>
    childEdge(item, freezePath([...path, index]), depth, bindingId, state),
  );
  const rest =
    record.rest === undefined
      ? undefined
      : childEdge(record.rest, freezePath([...path, "..."]), depth, bindingId, state);
  return { id, path, kind: "tuple", items: Object.freeze(items), rest, ...available() };
}

function unionNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorNode {
  if (!Array.isArray(record.variants)) return unknownNode(id, path, "invalid-shape");
  const variants = record.variants.map((variant, index) =>
    childEdge(variant, freezePath([...path, "$variant", index]), depth, bindingId, state),
  );
  return { id, path, kind: "union", variants: Object.freeze(variants), ...available() };
}

function referenceNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  bindingId: string,
  state: GraphState,
): EditorNode {
  if (typeof record.definition !== "string" || record.definition.length === 0) {
    return unknownNode(id, path, "invalid-shape");
  }
  const node: EditorReferenceNode = {
    id,
    path,
    kind: "reference",
    definition: record.definition,
    status: "unresolved",
    availability: "unknown",
    evidence: evidence("unresolved-reference", path),
  };
  state.references.push({ index: state.nodes.length - 1, bindingId });
  return node;
}

function childEdge(
  shape: unknown,
  path: HostPath,
  depth: number,
  bindingId: string,
  state: GraphState,
): EditorEdge {
  state.edges += 1;
  if (state.edges > state.limits.maxEdges) return unknownEdge("edge-limit", path, state);
  return addNode(shape, path, depth + 1, bindingId, state);
}

function unknownEdge(code: EditorUnknownCode, path: HostPath, state: GraphState): EditorEdge {
  if (state.limitNodeId) return edge(state.limitNodeId, path, false);
  const id = `n${state.nodes.length}`;
  state.limitNodeId = id;
  state.nodes.push(unknownNode(id, path, code));
  return edge(id, path, false);
}

function unknownNode(id: string, path: HostPath, code: EditorUnknownCode): EditorNode {
  return {
    id,
    path,
    kind: "unknown",
    availability: "unknown",
    evidence: evidence(code, path),
  };
}

function resolveReferences(state: GraphState, targets: Map<string, Map<string, string>>): void {
  for (const reference of state.references) {
    const node = state.nodes[reference.index];
    if (node?.kind !== "reference") continue;
    const target = targets.get(reference.bindingId)?.get(node.definition);
    if (!target) continue;
    state.nodes[reference.index] = {
      ...node,
      status: "resolved",
      target: edge(target, node.path, false),
      availability: "available",
      evidence: Object.freeze([]),
    };
  }
}

function available(): Pick<EditorNode, "availability" | "evidence"> {
  return { availability: "available", evidence: Object.freeze([]) };
}

function evidence(code: EditorUnknownCode, path: HostPath) {
  return Object.freeze([Object.freeze({ code, path })]);
}

function edge(nodeId: string, path: HostPath, cycle: boolean): EditorEdge {
  return Object.freeze({ nodeId, path, cycle });
}

function freezePath(path: HostPath): HostPath {
  return Object.freeze([...path]);
}

function normalizeLimits(input: Partial<EditorGraphLimits>): EditorGraphLimits {
  return Object.freeze({
    maxDepth: positiveInteger(input.maxDepth, DEFAULT_EDITOR_GRAPH_LIMITS.maxDepth),
    maxNodes: positiveInteger(input.maxNodes, DEFAULT_EDITOR_GRAPH_LIMITS.maxNodes),
    maxEdges: positiveInteger(input.maxEdges, DEFAULT_EDITOR_GRAPH_LIMITS.maxEdges),
  });
}

function positiveInteger(input: unknown, fallback: number): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? input : fallback;
}

import {
  createEditorGraphEdgeMeter,
  type EditorGraphEdgeCategory,
  type EditorGraphEdgeMeter,
} from "./editor-admission.js";
import { markReferenceCycles } from "./editor-cycle.js";
import { compositeEvidenceNode, evidenceNode } from "./editor-evidence-builders.js";
import { readEditorEvidence } from "./editor-input-validation.js";
import {
  arrayNode,
  declaredUnknownNode,
  evidence,
  type NodeBuildContext,
  objectNode,
  scalarNode,
  tupleNode,
  unionNode,
  unknownNode,
  withNodeEvidence,
} from "./editor-node-builders.js";
import type {
  EditorEdge,
  EditorGraph,
  EditorGraphDefinition,
  EditorGraphInput,
  EditorGraphLimits,
  EditorGraphRoot,
  EditorNode,
  EditorReferenceNode,
  EditorUnknownCode,
  EditorUnknownEvidence,
  HostPath,
} from "./editor-types.js";
import { readArray, readArrayPrefix } from "./input-readers.js";
import { readOwnDataRecord } from "./serializable.js";

export const DEFAULT_EDITOR_GRAPH_LIMITS: EditorGraphLimits = Object.freeze({
  maxDepth: 32,
  maxNodes: 2_048,
  maxEdges: 8_192,
});

interface GraphState {
  readonly limits: EditorGraphLimits;
  readonly nodes: EditorNode[];
  readonly active: WeakMap<object, string>;
  readonly references: { index: number; bindingId: string }[];
  readonly evidence: EditorUnknownEvidence[];
  readonly meter: EditorGraphEdgeMeter;
  limitNodeIndex?: number;
}

export function createEditorGraph(
  inputs: readonly EditorGraphInput[],
  requestedLimits: Partial<EditorGraphLimits> = {},
): EditorGraph {
  let limits = DEFAULT_EDITOR_GRAPH_LIMITS;
  try {
    const normalized = normalizeLimits(requestedLimits);
    if (!normalized) return invalidGraph(limits);
    limits = normalized;
    return buildGraph(inputs, limits);
  } catch {
    return invalidGraph(limits);
  }
}

function buildGraph(inputs: readonly EditorGraphInput[], limits: EditorGraphLimits): EditorGraph {
  const sourceDocuments = readArrayPrefix(inputs, limits.maxEdges + 1);
  if (!sourceDocuments) return invalidGraph(limits, "invalid-shape");
  const state = createState(limits);
  const roots: EditorGraphRoot[] = [];
  const definitions: EditorGraphDefinition[] = [];
  const targets = new Map<string, Map<string, string>>();
  for (const input of sourceDocuments.items) {
    const inspected = readGraphInput(input);
    if (!inspected) return invalidGraph(limits, "invalid-shape");
    addDocument(inspected, state, roots, definitions, targets);
  }
  if (sourceDocuments.truncated) recordEvidence("edge-limit", Object.freeze([]), state);
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
    evidence: Object.freeze(state.evidence),
    admission: state.meter.snapshot(),
  });
}

function invalidGraph(
  limits: EditorGraphLimits,
  code: EditorUnknownCode = "invalid-shape",
): EditorGraph {
  const path = Object.freeze([]);
  const node = Object.freeze(unknownNode("n0", path, code));
  const root = Object.freeze({ ...edge("n0", path, false), bindingId: "<invalid>" });
  return Object.freeze({
    format: "kalada-editor-graph-v1",
    nodeIdScope: "document-local",
    limits,
    roots: Object.freeze([root]),
    nodes: Object.freeze([node]),
    definitions: Object.freeze([]),
    evidence: evidence(code, path),
    admission: createEditorGraphEdgeMeter(limits.maxEdges).snapshot(),
  });
}

function createState(limits: EditorGraphLimits): GraphState {
  return {
    limits,
    nodes: [],
    active: new WeakMap(),
    references: [],
    evidence: [],
    meter: createEditorGraphEdgeMeter(limits.maxEdges),
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
  if (!claimEdge("root", path, state)) return;
  const root = addNode(input.document.root, path, 0, input.bindingId, state);
  roots.push(Object.freeze({ ...root, bindingId: input.bindingId }));
  const bindingTargets = new Map<string, string>();
  targets.set(input.bindingId, bindingTargets);
  const sourceDefinitions = readArrayPrefix(
    input.document.definitions ?? [],
    state.limits.maxEdges + 1,
  );
  if (!sourceDefinitions) {
    recordEvidence("invalid-shape", path, state);
    return;
  }
  for (const definition of sourceDefinitions.items) {
    const inspected = readDefinition(definition);
    if (!inspected) {
      recordEvidence("invalid-shape", path, state);
      continue;
    }
    addDefinition(input, inspected, state, definitions, bindingTargets);
  }
  if (sourceDefinitions.truncated) recordEvidence("edge-limit", path, state);
  for (const code of input.document.evidence ?? []) recordEvidence(code, path, state);
}

function addDefinition(
  input: EditorGraphInput,
  definition: { readonly name: string; readonly shape: unknown },
  state: GraphState,
  definitions: EditorGraphDefinition[],
  targets: Map<string, string>,
): void {
  const path = freezePath([...input.path, "$defs", definition.name]);
  if (!claimEdge("definition", path, state)) return;
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
  const prior = state.active.get(shape);
  if (prior) return edge(prior, path, true);
  if (state.nodes.length >= state.limits.maxNodes - 1)
    return unknownEdge("node-limit", path, state);
  const id = `n${state.nodes.length}`;
  state.active.set(shape, id);
  const index = state.nodes.length;
  state.nodes.push(unknownNode(id, path, "invalid-shape"));
  state.nodes[index] = readNode(shape, id, path, depth, bindingId, state);
  state.active.delete(shape);
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
  const context = nodeContext(depth, bindingId, state);
  const node = buildNode(record, id, path, bindingId, state, context);
  return withNodeEvidence(node, record, path, context);
}

function buildNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  bindingId: string,
  state: GraphState,
  context: NodeBuildContext,
): EditorNode {
  if (record.kind === "scalar") return scalarNode(record, id, path);
  if (record.kind === "unknown") return declaredUnknownNode(record, id, path);
  if (record.kind === "object") return objectNode(record, id, path, context);
  if (record.kind === "array") return arrayNode(record, id, path, context);
  if (record.kind === "tuple") return tupleNode(record, id, path, context);
  if (record.kind === "union") return unionNode(record, id, path, context);
  if (record.kind === "reference") return referenceNode(record, id, path, bindingId, state);
  return (
    evidenceNode(record, id, path) ??
    compositeEvidenceNode(record, id, path, context) ??
    unknownNode(id, path, "unsupported-shape")
  );
}

function nodeContext(depth: number, bindingId: string, state: GraphState): NodeBuildContext {
  return {
    maximumCollectionSize: state.limits.maxEdges + 1,
    child: (shape, path) => childEdge(shape, path, depth, bindingId, state),
  };
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
  const unresolved = typeof record.unresolved === "string" ? record.unresolved : undefined;
  const node: EditorReferenceNode = {
    id,
    path,
    kind: "reference",
    definition: record.definition,
    status: "unresolved",
    availability: unresolved === undefined ? "unknown" : "unavailable",
    evidence: evidence("unresolved-reference", path),
    relations: Object.freeze([]),
    ...(typeof record.reference === "string" ? { reference: record.reference } : {}),
    ...(unresolved === undefined ? {} : { unresolved }),
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
): EditorEdge | null {
  if (!claimEdge("child", path, state)) return null;
  return addNode(shape, path, depth + 1, bindingId, state);
}

function unknownEdge(code: EditorUnknownCode, path: HostPath, state: GraphState): EditorEdge {
  if (state.limitNodeIndex !== undefined) {
    const index = state.limitNodeIndex;
    appendUnknownEvidence(index, code, path, state);
    return edge(`n${index}`, path, false);
  }
  const id = `n${state.nodes.length}`;
  state.limitNodeIndex = state.nodes.length;
  state.nodes.push(unknownNode(id, path, code));
  return edge(id, path, false);
}

function appendUnknownEvidence(
  index: number,
  code: EditorUnknownCode,
  path: HostPath,
  state: GraphState,
): void {
  const node = state.nodes[index];
  if (node?.kind !== "unknown" || node.evidence.length >= state.limits.maxEdges) return;
  if (node.evidence.some((item) => item.code === code && samePath(item.path, path))) return;
  const item = Object.freeze({ code, path: freezePath(path) });
  state.nodes[index] = { ...node, evidence: Object.freeze([...node.evidence, item]) };
}

function resolveReferences(state: GraphState, targets: Map<string, Map<string, string>>): void {
  for (const reference of state.references) {
    const node = state.nodes[reference.index];
    if (node?.kind !== "reference" || node.unresolved !== undefined) continue;
    const target = targets.get(reference.bindingId)?.get(node.definition);
    if (!target) continue;
    if (!claimEdge("resolution", node.path, state)) {
      state.nodes[reference.index] = {
        ...node,
        evidence: evidence("edge-limit", node.path),
      };
      continue;
    }
    state.nodes[reference.index] = {
      ...node,
      status: "resolved",
      target: edge(target, node.path, false),
      availability: "available",
      evidence: Object.freeze([]),
    };
  }
}

function edge(nodeId: string, path: HostPath, cycle: boolean): EditorEdge {
  return Object.freeze({ nodeId, path, cycle });
}

function claimEdge(category: EditorGraphEdgeCategory, path: HostPath, state: GraphState): boolean {
  if (!state.meter.claim(category)) {
    recordEvidence("edge-limit", path, state);
    return false;
  }
  return true;
}

function recordEvidence(code: EditorUnknownCode, path: HostPath, state: GraphState): void {
  if (state.evidence.length >= state.limits.maxEdges) return;
  if (state.evidence.some((item) => item.code === code && samePath(item.path, path))) return;
  state.evidence.push(Object.freeze({ code, path: freezePath(path) }));
}

function samePath(left: HostPath, right: HostPath): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function readGraphInput(input: unknown): EditorGraphInput | null {
  const inspected = readOwnDataRecord(input, 4);
  if (!inspected.ok || typeof inspected.value.bindingId !== "string") return null;
  const path = readArray(inspected.value.path, 256);
  const document = readOwnDataRecord(inspected.value.document, 4);
  if (!path || !document.ok || document.value.root === undefined) return null;
  if (!path.every((part) => typeof part === "string" || typeof part === "number")) return null;
  return {
    bindingId: inspected.value.bindingId,
    path: freezePath(path as HostPath),
    document: {
      root: document.value.root as never,
      definitions: document.value.definitions as never,
      evidence: readEditorEvidence(document.value.evidence),
    },
  };
}

function readDefinition(input: unknown): { readonly name: string; readonly shape: unknown } | null {
  const inspected = readOwnDataRecord(input, 3);
  if (!inspected.ok || typeof inspected.value.name !== "string") return null;
  return Object.freeze({ name: inspected.value.name, shape: inspected.value.shape });
}

function freezePath(path: HostPath): HostPath {
  return Object.freeze([...path]);
}

function normalizeLimits(input: unknown): EditorGraphLimits | null {
  const inspected = readOwnDataRecord(input, 3);
  if (!inspected.ok) return null;
  const record = inspected.value;
  return Object.freeze({
    maxDepth: positiveInteger(record.maxDepth, DEFAULT_EDITOR_GRAPH_LIMITS.maxDepth),
    maxNodes: positiveInteger(record.maxNodes, DEFAULT_EDITOR_GRAPH_LIMITS.maxNodes),
    maxEdges: positiveInteger(record.maxEdges, DEFAULT_EDITOR_GRAPH_LIMITS.maxEdges),
  });
}

function positiveInteger(input: unknown, fallback: number): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? input : fallback;
}

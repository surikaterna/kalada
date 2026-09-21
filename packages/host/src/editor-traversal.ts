import type {
  EditorEdge,
  EditorGraph,
  EditorNode,
  EditorTraversalOptions,
  EditorTraversalStep,
} from "./editor-types.js";

interface TraversalState {
  readonly nodes: ReadonlyMap<string, EditorNode>;
  readonly steps: EditorTraversalStep[];
  readonly active: Set<string>;
  readonly maxDepth: number;
  readonly maxVisits: number;
}

export function traverseEditorGraph(
  graph: EditorGraph,
  options: EditorTraversalOptions = {},
): readonly EditorTraversalStep[] {
  const state: TraversalState = {
    nodes: new Map(graph.nodes.map((node) => [node.id, node])),
    steps: [],
    active: new Set(),
    maxDepth: bounded(options.maxDepth, graph.limits.maxDepth),
    maxVisits: bounded(options.maxVisits, graph.limits.maxEdges + graph.limits.maxNodes),
  };
  for (const root of graph.roots) {
    walk(root, "root", 0, state);
    if (state.steps.length >= state.maxVisits) break;
  }
  return Object.freeze(state.steps);
}

function walk(
  edge: EditorEdge,
  via: EditorTraversalStep["via"],
  depth: number,
  state: TraversalState,
): void {
  if (depth > state.maxDepth || state.steps.length >= state.maxVisits) return;
  const node = state.nodes.get(edge.nodeId);
  if (!node) return;
  const cycle = edge.cycle || state.active.has(edge.nodeId);
  state.steps.push(
    Object.freeze({
      nodeId: edge.nodeId,
      path: Object.freeze([...edge.path]),
      depth,
      via,
      cycle,
      availability: node.availability,
    }),
  );
  if (cycle || depth === state.maxDepth) return;
  state.active.add(edge.nodeId);
  walkChildren(node, depth, state);
  state.active.delete(edge.nodeId);
}

function walkChildren(node: EditorNode, depth: number, state: TraversalState): void {
  if (node.kind === "object") {
    for (const property of node.properties) walk(property, "property", depth + 1, state);
    return;
  }
  if (node.kind === "array") {
    walk(node.element, "element", depth + 1, state);
    return;
  }
  if (node.kind === "tuple") {
    walkTuple(node, depth, state);
    return;
  }
  if (node.kind === "union") {
    for (const variant of node.variants) walk(variant, "variant", depth + 1, state);
    return;
  }
  if (node.kind === "reference" && node.target) {
    walk(node.target, "reference", depth + 1, state);
  }
}

function walkTuple(
  node: Extract<EditorNode, { kind: "tuple" }>,
  depth: number,
  state: TraversalState,
): void {
  for (const item of node.items) walk(item, "item", depth + 1, state);
  if (node.rest) walk(node.rest, "rest", depth + 1, state);
}

function bounded(input: unknown, fallback: number): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) return fallback;
  return Math.min(input, fallback);
}

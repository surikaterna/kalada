import type { EditorEdge, EditorNode } from "./editor-types.js";

export function markReferenceCycles(
  nodes: EditorNode[],
  references: readonly { readonly index: number }[],
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const reference of references) {
    const node = nodes[reference.index];
    if (node?.kind !== "reference" || !node.target) continue;
    if (!isReachable(byId, node.target.nodeId, node.id)) continue;
    nodes[reference.index] = {
      ...node,
      target: cycleEdge(node.target),
    };
  }
}

function isReachable(
  nodes: ReadonlyMap<string, EditorNode>,
  start: string,
  target: string,
): boolean {
  const pending = [start];
  const discovered = new Set([start]);
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id) continue;
    if (id === target) return true;
    const node = nodes.get(id);
    if (node) addUndiscovered(outgoingNodeIds(node), discovered, pending);
  }
  return false;
}

function addUndiscovered(
  next: readonly string[],
  discovered: Set<string>,
  pending: string[],
): void {
  for (const id of next) {
    if (discovered.has(id)) continue;
    discovered.add(id);
    pending.push(id);
  }
}

function outgoingNodeIds(node: EditorNode): string[] {
  if (node.kind === "object") return node.properties.map(({ nodeId }) => nodeId);
  if (node.kind === "array") return [node.element.nodeId];
  if (node.kind === "tuple") {
    return [...node.items.map(({ nodeId }) => nodeId), ...(node.rest ? [node.rest.nodeId] : [])];
  }
  if (node.kind === "union") return node.variants.map(({ nodeId }) => nodeId);
  if (node.kind === "reference" && node.target) return [node.target.nodeId];
  return [];
}

function cycleEdge(edge: EditorEdge): EditorEdge {
  return Object.freeze({ nodeId: edge.nodeId, path: edge.path, cycle: true });
}

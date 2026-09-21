import type { EditorEdge, EditorNode } from "./editor-types.js";

export function markReferenceCycles(
  nodes: EditorNode[],
  references: readonly { readonly index: number }[],
): void {
  for (const reference of references) {
    const node = nodes[reference.index];
    if (node?.kind !== "reference" || !node.target) continue;
    if (!isReachable(nodes, node.target.nodeId, node.id)) continue;
    nodes[reference.index] = {
      ...node,
      target: cycleEdge(node.target),
    };
  }
}

function isReachable(nodes: readonly EditorNode[], start: string, target: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0 && visited.size <= nodes.length) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    if (id === target) return true;
    visited.add(id);
    const node = byId.get(id);
    if (node) pending.push(...outgoingNodeIds(node));
  }
  return false;
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

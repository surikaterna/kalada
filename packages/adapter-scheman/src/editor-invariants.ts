import type { EditorGraph, EditorNode } from "@kalada/host";

export function validNormalizedEditorGraph(
  graph: EditorGraph,
  bindingId: string,
  intendedSourceId: string,
): boolean {
  if (!graph.admission || graph.admission.total > graph.admission.budget) return false;
  const root = graph.roots.find((item) => item.bindingId === bindingId);
  if (!root) return false;
  const rootNode = nodeById(graph, root.nodeId);
  if (!rootNode || !validRootNode(graph, rootNode, intendedSourceId)) return false;
  return graph.nodes.every((node) => !isRetainedLocalReference(node) || node.status === "resolved");
}

function validRootNode(graph: EditorGraph, root: EditorNode, intendedSourceId: string): boolean {
  if (intentionalBoundedUnknown(root)) return true;
  if (root.kind !== "reference" || root.status !== "resolved" || !root.target) return false;
  const target = nodeById(graph, root.target.nodeId);
  return Boolean(
    target && (target.sourceId === intendedSourceId || intentionalBoundedUnknown(target)),
  );
}

function isRetainedLocalReference(
  node: EditorNode,
): node is Extract<EditorNode, { kind: "reference" }> {
  if (node.kind !== "reference" || node.unresolved) return false;
  return node.reference === undefined || node.reference.startsWith("#");
}

function intentionalBoundedUnknown(node: EditorNode): boolean {
  return (
    node.kind === "unknown" &&
    node.evidence.some((item) => item.code === "edge-limit" || item.code === "node-limit")
  );
}

function nodeById(graph: EditorGraph, nodeId: string): EditorNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

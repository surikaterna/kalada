import type { SchemaDocument, SchemaNode } from "@scheman/core";

export function eligibleLocalReference(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "ref" }>,
  document: SchemaDocument,
): boolean {
  if (!node.target || node.unresolved || !node.reference.startsWith("#")) return false;
  if (!document.nodes[node.target.nodeId]) return false;
  return !document.diagnostics.some(
    (diagnostic) =>
      blockedReferenceCode(diagnostic.code) &&
      (diagnostic.nodeId === nodeId || diagnostic.nodeId === node.target?.nodeId),
  );
}

function blockedReferenceCode(code: string): boolean {
  return (
    code === "JSON_RESOURCE_REBASE_UNSUPPORTED" ||
    code === "JSON_UNRESOLVED_REFERENCE" ||
    code === "JSON_INVALID_REFERENCE"
  );
}

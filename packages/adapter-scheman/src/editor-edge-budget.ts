import type { EditorShape } from "@kalada/host";
import type { SchemaDocument, SchemaNode } from "@scheman/core";
import { eligibleLocalReference } from "./local-reference.js";

export class EditorEdgeBudget {
  readonly maximum: number;
  readonly normalLimit: number;
  used = 0;
  truncated: boolean;
  private limitEdgeEmitted = false;

  constructor(maximum: number, sourceEdges: number) {
    this.maximum = maximum;
    this.truncated = sourceEdges > maximum;
    this.normalLimit = this.truncated ? Math.max(0, maximum - 1) : maximum;
  }

  claim(): boolean {
    if (this.used >= this.normalLimit) return false;
    this.used += 1;
    return true;
  }

  limitEdge(sourceId: string): EditorShape | null {
    this.truncated = true;
    if (this.limitEdgeEmitted || this.used >= this.maximum) return null;
    this.limitEdgeEmitted = true;
    this.used += 1;
    return edgeLimitShape(sourceId);
  }

  limitNode(sourceId: string): EditorShape {
    this.truncated = true;
    return edgeLimitShape(sourceId);
  }

  get exhausted(): boolean {
    return this.truncated && this.used >= this.maximum;
  }
}

export function countEditorEdges(
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  maximum: number,
): number {
  let count = 0;
  for (const nodeId in document.nodes) {
    if (!selected.has(nodeId) || !Object.hasOwn(document.nodes, nodeId)) continue;
    const node = document.nodes[nodeId];
    if (!node) continue;
    count += nodeEdges(nodeId, node, document);
    if (count > maximum) return maximum + 1;
  }
  return count;
}

function nodeEdges(nodeId: string, node: SchemaNode, document: SchemaDocument): number {
  const relations = relationEdges(node);
  if (node.kind === "object") {
    return relations + node.properties.length + (node.additionalProperties ? 1 : 0);
  }
  if (node.kind === "array") return relations + 1;
  if (node.kind === "tuple") return relations + node.items.length + (node.rest ? 1 : 0);
  if (node.kind === "record") return relations + 2;
  if (node.kind === "union") return relations + node.alternatives.length;
  if (node.kind === "intersection") return relations + node.operands.length;
  if (node.kind === "wrapper") return relations + 1;
  if (node.kind === "ref" && eligibleLocalReference(nodeId, node, document)) return relations + 1;
  return relations;
}

function relationEdges(node: SchemaNode): number {
  const value = node.applicators;
  if (!value) return 0;
  let count = 0;
  for (const name of ["if", "then", "else", "not", "contains", "propertyNames"] as const) {
    if (value[name]) count += 1;
  }
  return (
    count +
    Object.keys(value.patternProperties ?? {}).length +
    Object.keys(value.dependentSchemas ?? {}).length
  );
}

function edgeLimitShape(sourceId: string): EditorShape {
  return {
    kind: "unknown",
    reason: `bounded-edge:${sourceId}`,
    evidenceCode: "edge-limit",
    sourceId,
  };
}

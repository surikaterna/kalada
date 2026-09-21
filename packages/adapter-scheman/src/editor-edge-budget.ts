import type { EditorRelationShape, EditorShape } from "@kalada/host";
import type { SchemaDocument, SchemaNode } from "@scheman/core";
import { eligibleLocalReference } from "./local-reference.js";

export interface EditorCollectionSummary {
  readonly retained: number;
  readonly total: number;
  readonly truncated: boolean;
}

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

export class RequiredNamesBudget {
  readonly hasOverflow: boolean;
  readonly maximumPerObject: number;
  readonly total: number;
  retained = 0;

  constructor(document: SchemaDocument, selected: ReadonlySet<string>, maximum: number) {
    this.maximumPerObject = maximum;
    const source = selectedRequiredNames(document, selected, maximum);
    this.hasOverflow = source.hasOverflow;
    this.total = source.total;
  }

  retain(values: readonly string[]): readonly string[] {
    const retained = values.slice(0, this.maximumPerObject);
    this.retained += retained.length;
    return retained;
  }

  requiresEvidence(node: SchemaNode): boolean {
    return node.kind === "object" && node.required.length > this.maximumPerObject;
  }

  structuralEdgeMaximum(maximum: number, definitionCount: number): number {
    return this.hasOverflow ? Math.max(1, maximum - definitionCount - 2) : maximum;
  }

  summary(): EditorCollectionSummary {
    return Object.freeze({
      retained: this.retained,
      total: this.total,
      truncated: this.retained < this.total,
    });
  }
}

export function selectEditorNodes(document: SchemaDocument, maximum: number) {
  const ids = new Set<string>();
  let truncated = false;
  const add = (nodeId: string): void => {
    if (ids.has(nodeId) || !Object.hasOwn(document.nodes, nodeId)) return;
    if (ids.size < maximum) ids.add(nodeId);
    else truncated = true;
  };
  add(document.root.input.nodeId);
  add(document.root.output.nodeId);
  for (const definition of document.definitions) add(definition.node.nodeId);
  for (const nodeId in document.nodes) {
    if (!Object.hasOwn(document.nodes, nodeId)) continue;
    add(nodeId);
    if (truncated) break;
  }
  return Object.freeze({ ids, truncated });
}

export function requiredNamesLimitRelation(
  nodeId: string,
  budget: EditorEdgeBudget,
): readonly EditorRelationShape[] {
  const sourceId = `${nodeId}.requiredNames`;
  const shape = budget.claim()
    ? {
        kind: "unknown" as const,
        reason: `bounded-required-names:${nodeId}`,
        evidenceCode: "edge-limit" as const,
        sourceId,
      }
    : budget.limitEdge(sourceId);
  return shape ? [{ name: "requiredNames", shape }] : [];
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
    count += nodeEdges(nodeId, node, document, maximum);
    if (count > maximum) return maximum + 1;
  }
  return count;
}

function nodeEdges(
  nodeId: string,
  node: SchemaNode,
  document: SchemaDocument,
  maximum: number,
): number {
  const relations = relationEdges(node);
  if (node.kind === "object") {
    const requiredEvidence = node.required.length > maximum ? 1 : 0;
    return (
      relations + requiredEvidence + node.properties.length + (node.additionalProperties ? 1 : 0)
    );
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

function selectedRequiredNames(
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  maximum: number,
) {
  let total = 0;
  let hasOverflow = false;
  for (const nodeId of selected) {
    const node = document.nodes[nodeId];
    if (node?.kind !== "object") continue;
    total += node.required.length;
    if (node.required.length > maximum) hasOverflow = true;
  }
  return Object.freeze({ total, hasOverflow });
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

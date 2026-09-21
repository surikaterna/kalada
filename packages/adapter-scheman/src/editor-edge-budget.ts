import type { EditorShape } from "@kalada/host";
import { calculateEditorGraphAdmission, type EditorGraphAdmission } from "@kalada/host";
import type { NodeRef, SchemaDocument, SchemaNode } from "@scheman/core";
import { eligibleLocalReference } from "./local-reference.js";

export interface EditorCollectionSummary {
  readonly retained: number;
  readonly total: number;
  readonly truncated: boolean;
}

export interface EditorNodeSelection {
  readonly ids: ReadonlySet<string>;
  readonly rootBounded: boolean;
  readonly truncated: boolean;
}

export class EditorAdmissionBudget {
  readonly definitions: number;
  readonly maximum: number;
  readonly rootResolution: number;
  readonly reserve: number;
  admittedSourceEdges = 0;
  children = 0;
  evidenceUsed = false;
  resolutions = 0;
  truncated = false;
  private closed = false;

  constructor(maximum: number, definitions: number, rootBounded: boolean) {
    this.maximum = maximum;
    this.definitions = definitions;
    this.rootResolution = rootBounded ? 0 : 1;
    this.reserve = rootBounded ? 0 : 1;
  }

  claimChild(reference: NodeRef, selected: ReadonlySet<string>): boolean {
    const local = selected.has(reference.nodeId);
    if (!this.canAdmit(1, local ? 1 : 0)) return false;
    this.children += 1;
    this.resolutions += local ? 1 : 0;
    this.admittedSourceEdges += 1;
    return true;
  }

  claimChildren(references: readonly NodeRef[], selected: ReadonlySet<string>): boolean {
    const resolutions = references.filter((item) => selected.has(item.nodeId)).length;
    if (!this.canAdmit(references.length, resolutions)) return false;
    this.children += references.length;
    this.resolutions += resolutions;
    this.admittedSourceEdges += references.length;
    return true;
  }

  claimDefinitionReference(): boolean {
    if (!this.canAdmit(0, 1)) return false;
    this.resolutions += 1;
    this.admittedSourceEdges += 1;
    return true;
  }

  evidenceEdge(_sourceId: string): EditorShape | null {
    this.truncated = true;
    this.closed = true;
    if (this.evidenceUsed || this.reserve === 0) return null;
    this.evidenceUsed = true;
    return null;
  }

  limitNode(sourceId: string): EditorShape {
    this.truncated = true;
    this.closed = true;
    return edgeLimitShape(sourceId);
  }

  admission(): EditorGraphAdmission {
    return calculateEditorGraphAdmission({
      maxEdges: this.maximum,
      roots: 1,
      definitions: this.definitions,
      children: this.children,
      resolutions: this.rootResolution + this.resolutions,
      evidenceReserve: this.reserve,
    });
  }

  get exhausted(): boolean {
    return this.closed;
  }

  private canAdmit(children: number, resolutions: number): boolean {
    if (this.closed) return false;
    const admission = calculateEditorGraphAdmission({
      maxEdges: this.maximum,
      roots: 1,
      definitions: this.definitions,
      children: this.children + children,
      resolutions: this.rootResolution + this.resolutions + resolutions,
      evidenceReserve: this.reserve,
    });
    if (admission.backboneAdmitted && !admission.truncated) return true;
    this.truncated = true;
    this.closed = true;
    return false;
  }
}

export class RequiredNamesBudget {
  readonly maximumPerObject: number;
  readonly total: number;
  retained = 0;

  constructor(document: SchemaDocument, selected: ReadonlySet<string>, maximum: number) {
    this.maximumPerObject = maximum;
    this.total = selectedRequiredNames(document, selected);
  }

  retain(values: readonly string[]): readonly string[] {
    const retained = values.slice(0, this.maximumPerObject);
    this.retained += retained.length;
    return retained;
  }

  requiresEvidence(node: SchemaNode): boolean {
    return node.kind === "object" && node.required.length > this.maximumPerObject;
  }

  summary(): EditorCollectionSummary {
    return Object.freeze({
      retained: this.retained,
      total: this.total,
      truncated: this.retained < this.total,
    });
  }
}

export function selectEditorNodes(
  document: SchemaDocument,
  maximumNodes: number,
  maximumEdges: number,
): EditorNodeSelection {
  if (maximumEdges < 4) {
    return Object.freeze({ ids: new Set<string>(), rootBounded: true, truncated: true });
  }
  const maximum = Math.min(maximumNodes, maximumEdges - 3);
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
  }
  return Object.freeze({ ids, rootBounded: false, truncated });
}

export function countSourceEditorEdges(
  document: SchemaDocument,
  selected: ReadonlySet<string>,
): number {
  let total = 0;
  for (const nodeId of selected) {
    const node = document.nodes[nodeId];
    if (!node) continue;
    total += nodeSourceEdges(nodeId, node, document);
  }
  return total;
}

function selectedRequiredNames(document: SchemaDocument, selected: ReadonlySet<string>): number {
  let total = 0;
  for (const nodeId of selected) {
    const node = document.nodes[nodeId];
    if (node?.kind === "object") total += node.required.length;
  }
  return total;
}

function nodeSourceEdges(nodeId: string, node: SchemaNode, document: SchemaDocument): number {
  let total = applicatorEdgeCount(node);
  if (node.kind === "object") total += node.properties.length + (node.additionalProperties ? 1 : 0);
  if (node.kind === "array") total += 1;
  if (node.kind === "tuple") total += node.items.length + (node.rest ? 1 : 0);
  if (node.kind === "record") total += 2;
  if (node.kind === "union") total += node.alternatives.length;
  if (node.kind === "intersection") total += node.operands.length;
  if (node.kind === "wrapper") total += 1;
  if (node.kind === "ref" && eligibleLocalReference(nodeId, node, document)) total += 1;
  return total;
}

function applicatorEdgeCount(node: SchemaNode): number {
  const applicators = node.applicators;
  if (!applicators) return 0;
  let total = 0;
  for (const name of ["if", "then", "else", "not", "contains", "propertyNames"] as const) {
    if (applicators[name]) total += 1;
  }
  return (
    total +
    Object.keys(applicators.patternProperties ?? {}).length +
    Object.keys(applicators.dependentSchemas ?? {}).length
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

import type { EditorRelationShape, EditorShape } from "@kalada/host";
import type { Applicators, NodeRef, OwnedValue, SchemaNode } from "@scheman/core";
import type { EditorAdmissionBudget, RequiredNamesBudget } from "./editor-edge-budget.js";

export interface EditorNodeEvidence {
  readonly sourceId: string;
  readonly annotations?: OwnedValue;
  readonly constraints?: OwnedValue;
  readonly relations: readonly EditorRelationShape[];
}

export function nodeEvidence(
  nodeId: string,
  node: SchemaNode,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
  requiredNames: RequiredNamesBudget,
): EditorNodeEvidence {
  const relations = applicatorRelations(nodeId, node.applicators, selected, budget);
  const required = requiredNames.requiresEvidence(node)
    ? requiredNamesLimitRelation(nodeId, budget)
    : [];
  return {
    sourceId: nodeId,
    ...(node.metadata === undefined ? {} : { annotations: node.metadata }),
    ...(node.constraints === undefined ? {} : { constraints: node.constraints }),
    relations: Object.freeze([...relations, ...required]),
  };
}

function applicatorRelations(
  nodeId: string,
  applicators: Applicators | undefined,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): readonly EditorRelationShape[] {
  if (!applicators) return Object.freeze([]);
  const output: EditorRelationShape[] = [];
  for (const name of ["if", "then", "else", "not", "contains", "propertyNames"] as const) {
    const target = applicators[name];
    if (!target) continue;
    const shape = edgeReference(target, `${nodeId}.${name}`, selected, budget);
    if (!shape) break;
    output.push({ name, shape });
    if (isEdgeLimit(shape)) return Object.freeze(output);
  }
  if (
    addKeyedRelations(
      nodeId,
      "patternProperties",
      applicators.patternProperties,
      output,
      selected,
      budget,
    )
  ) {
    return Object.freeze(output);
  }
  addKeyedRelations(
    nodeId,
    "dependentSchemas",
    applicators.dependentSchemas,
    output,
    selected,
    budget,
  );
  return Object.freeze(output);
}

function addKeyedRelations(
  nodeId: string,
  name: string,
  input: Readonly<Record<string, NodeRef>> | undefined,
  output: EditorRelationShape[],
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): boolean {
  for (const [key, target] of Object.entries(input ?? {})) {
    const shape = edgeReference(target, `${nodeId}.${name}.${key}`, selected, budget);
    if (!shape) return true;
    output.push({ name, key, shape });
    if (isEdgeLimit(shape)) return true;
  }
  return false;
}

function requiredNamesLimitRelation(
  nodeId: string,
  budget: EditorAdmissionBudget,
): readonly EditorRelationShape[] {
  const shape = budget.evidenceEdge(`${nodeId}.requiredNames`);
  return shape ? [{ name: "requiredNames", shape }] : [];
}

function edgeReference(
  value: NodeRef,
  source: string,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape | null {
  if (budget.claimChild(value, selected)) return reference(value.nodeId, selected);
  return budget.evidenceEdge(source);
}

function reference(definition: string, selected: ReadonlySet<string>): EditorShape {
  if (selected.has(definition)) return { kind: "reference", definition };
  return {
    kind: "unknown",
    reason: `bounded:${definition}`,
    evidenceCode: "node-limit",
    sourceId: definition,
  };
}

function isEdgeLimit(shape: EditorShape): boolean {
  return shape.kind === "unknown" && shape.evidenceCode === "edge-limit";
}

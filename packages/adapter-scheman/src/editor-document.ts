import type {
  EditorGraphAdmission,
  EditorShape,
  EditorUnknownCode,
  ManualEditorShapeDocument,
} from "@kalada/host";
import type { NodeRef, SchemaDocument, SchemaNode } from "@scheman/core";
import {
  countSourceEditorEdges,
  EditorAdmissionBudget,
  type EditorCollectionSummary,
  RequiredNamesBudget,
  selectEditorNodes,
} from "./editor-edge-budget.js";
import { nodeEvidence } from "./editor-relations.js";
import { eligibleLocalReference } from "./local-reference.js";
import type { SchemanAnalysisLimits } from "./types.js";

export interface SchemanEditorDocumentResult {
  readonly admission: EditorGraphAdmission;
  readonly document: ManualEditorShapeDocument;
  readonly retainedNodes: number;
  readonly retainedEdges: number;
  readonly sourceEdges: EditorCollectionSummary;
  readonly nodeTruncated: boolean;
  readonly edgeTruncated: boolean;
  readonly requiredNames: EditorCollectionSummary;
  readonly truncated: boolean;
}

export function schemanEditorDocument(
  source: SchemaDocument,
  limits: SchemanAnalysisLimits,
): SchemanEditorDocumentResult {
  const selection = selectEditorNodes(source, limits.maxNodes, limits.maxEdges);
  const requiredNames = new RequiredNamesBudget(source, selection.ids, limits.maxEdges);
  const sourceEdgeTotal = countSourceEditorEdges(source, selection.ids);
  const budget = new EditorAdmissionBudget(
    limits.maxEdges,
    selection.ids.size,
    selection.rootBounded,
  );
  const converted = convertDefinitions(source, selection.ids, budget, requiredNames);
  const definitions = prioritizedDefinitions(source, selection.ids, converted);
  const requiredNamesSummary = requiredNames.summary();
  const sourceEdges = Object.freeze({
    retained: budget.admittedSourceEdges,
    total: sourceEdgeTotal,
    truncated: budget.admittedSourceEdges < sourceEdgeTotal,
  });
  const evidence: EditorUnknownCode[] = [];
  if (sourceEdges.truncated || requiredNamesSummary.truncated) evidence.push("edge-limit" as const);
  if (selection.truncated) evidence.push("node-limit" as const);
  return Object.freeze({
    admission: budget.admission(),
    document: Object.freeze({
      root: selection.rootBounded
        ? budget.limitNode(source.root.input.nodeId)
        : reference(source.root.input.nodeId, selection.ids),
      definitions: Object.freeze(definitions),
      evidence: Object.freeze(evidence),
    }),
    retainedNodes: definitions.length,
    retainedEdges: budget.admittedSourceEdges,
    sourceEdges,
    nodeTruncated: selection.truncated,
    edgeTruncated: sourceEdges.truncated,
    requiredNames: requiredNamesSummary,
    truncated: selection.truncated || sourceEdges.truncated || requiredNamesSummary.truncated,
  });
}

function convertDefinitions(
  source: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
  requiredNames: RequiredNamesBudget,
): ReadonlyMap<string, EditorShape> {
  const converted = new Map<string, EditorShape>();
  for (const nodeId of selected) {
    const node = source.nodes[nodeId];
    if (node)
      converted.set(nodeId, convertNode(nodeId, node, source, selected, budget, requiredNames));
  }
  return converted;
}

function prioritizedDefinitions(
  source: SchemaDocument,
  selected: ReadonlySet<string>,
  converted: ReadonlyMap<string, EditorShape>,
) {
  const ids = [source.root.input.nodeId, ...Object.keys(source.nodes)];
  const emitted = new Set<string>();
  const definitions = [];
  for (const nodeId of ids) {
    if (emitted.has(nodeId) || !selected.has(nodeId)) continue;
    const shape = converted.get(nodeId);
    if (!shape) continue;
    emitted.add(nodeId);
    definitions.push(Object.freeze({ name: nodeId, shape }));
  }
  return definitions;
}

function convertNode(
  nodeId: string,
  node: SchemaNode,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
  requiredNames: RequiredNamesBudget,
): EditorShape {
  if (budget.exhausted) return budget.limitNode(nodeId);
  const shape = convertStructure(nodeId, node, document, selected, budget, requiredNames);
  const evidence = nodeEvidence(nodeId, node, selected, budget, requiredNames);
  return { ...shape, ...evidence } as EditorShape;
}

function convertStructure(
  nodeId: string,
  node: SchemaNode,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
  requiredNames: RequiredNamesBudget,
): EditorShape {
  const simple = simpleShape(node);
  if (simple) return simple;
  if (node.kind === "object") return objectShape(nodeId, node, selected, budget, requiredNames);
  if (node.kind === "array") return singleChildShape("array", nodeId, node.items, selected, budget);
  if (node.kind === "tuple") return tupleShape(nodeId, node, selected, budget);
  if (node.kind === "record") return recordShape(nodeId, node, selected, budget);
  if (node.kind === "union") return unionShape(nodeId, node, selected, budget);
  if (node.kind === "intersection") {
    return {
      kind: "intersection",
      operands: boundedReferences(node.operands, `${nodeId}.operand`, selected, budget),
    };
  }
  if (node.kind === "ref") return referenceShape(nodeId, node, document, selected, budget);
  if (node.kind === "wrapper") {
    const inner = edgeReference(node.inner, `${nodeId}.inner`, selected, budget);
    return inner
      ? {
          kind: "wrapper",
          wrapper: node.wrapper,
          inner,
          ...(node.value === undefined ? {} : { value: node.value }),
        }
      : budget.limitNode(nodeId);
  }
  return { kind: "unknown", reason: `unsupported:${nodeId}` };
}

function simpleShape(node: SchemaNode): EditorShape | undefined {
  if (node.kind === "unknown") return { kind: "unknown", reason: node.reason };
  if (node.kind === "opaque") return { kind: "opaque", reason: node.reason };
  if (node.kind === "unconstrained") return { kind: "unconstrained", domain: node.domain };
  if (node.kind === "never") return { kind: "never" };
  if (node.kind === "primitive") return { kind: "scalar", name: node.type };
  if (node.kind === "literal") return { kind: "literal", value: node.value };
  if (node.kind === "enum") return { kind: "enum", values: node.values };
  return undefined;
}

function objectShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "object" }>,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
  requiredNames: RequiredNamesBudget,
): EditorShape {
  const properties = [];
  let limited = false;
  for (const property of node.properties) {
    const shape = edgeReference(
      property.node,
      `${nodeId}.property.${property.name}`,
      selected,
      budget,
    );
    if (!shape) break;
    properties.push({
      name: property.name,
      required: property.presence === "required",
      presence: property.presence,
      shape,
    });
    if (isEdgeLimit(shape)) {
      limited = true;
      break;
    }
  }
  const additional = limited
    ? null
    : optionalEdgeReference(node.additionalProperties, `${nodeId}.additional`, selected, budget);
  return {
    kind: "object",
    properties,
    requiredNames: requiredNames.retain(node.required),
    unknownKeys: node.unknownKeys,
    ...(additional ? { additionalProperties: additional } : {}),
  };
}

function tupleShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "tuple" }>,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape {
  const items = boundedReferences(node.items, `${nodeId}.item`, selected, budget);
  const rest = isEdgeLimit(items.at(-1))
    ? null
    : optionalEdgeReference(node.rest, `${nodeId}.rest`, selected, budget);
  return { kind: "tuple", items, ...(rest ? { rest } : {}) };
}

function recordShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "record" }>,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape {
  if (!budget.claimChildren([node.key, node.value], selected)) return budget.limitNode(nodeId);
  return {
    kind: "record",
    key: reference(node.key.nodeId, selected),
    value: reference(node.value.nodeId, selected),
    exhaustive: node.exhaustive,
  };
}

function unionShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "union" }>,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape {
  return {
    kind: "union",
    variants: boundedReferences(node.alternatives, `${nodeId}.variant`, selected, budget),
    semantics: node.semantics,
    ...(node.discriminator === undefined ? {} : { discriminator: node.discriminator }),
  };
}

function singleChildShape(
  kind: "array",
  nodeId: string,
  value: NodeRef,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape {
  const element = edgeReference(value, `${nodeId}.items`, selected, budget);
  return element ? { kind, element } : budget.limitNode(nodeId);
}

function referenceShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "ref" }>,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape {
  if (!eligibleLocalReference(nodeId, node, document)) {
    return {
      kind: "reference",
      definition: `unsupported:${nodeId}`,
      reference: node.reference,
      unresolved: node.unresolved ?? "non-local-reference",
    };
  }
  const target = node.target?.nodeId as string;
  if (!selected.has(target)) {
    return {
      kind: "unknown",
      reason: `bounded-reference:${node.reference}`,
      evidenceCode: "node-limit",
    };
  }
  if (!budget.claimDefinitionReference()) return budget.limitNode(nodeId);
  return { kind: "reference", definition: target, reference: node.reference };
}

function boundedReferences(
  values: readonly NodeRef[],
  source: string,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): readonly EditorShape[] {
  const output: EditorShape[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    const shape = edgeReference(value, `${source}.${String(index)}`, selected, budget);
    if (!shape) break;
    output.push(shape);
    if (isEdgeLimit(shape)) break;
  }
  return output;
}

function optionalEdgeReference(
  value: NodeRef | undefined,
  source: string,
  selected: ReadonlySet<string>,
  budget: EditorAdmissionBudget,
): EditorShape | null {
  return value ? edgeReference(value, source, selected, budget) : null;
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

function isEdgeLimit(shape: EditorShape | undefined): boolean {
  return shape?.kind === "unknown" && shape.evidenceCode === "edge-limit";
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

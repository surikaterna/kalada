import type { EditorRelationShape, EditorShape, ManualEditorShapeDocument } from "@kalada/host";
import type { Applicators, NodeRef, OwnedValue, SchemaDocument, SchemaNode } from "@scheman/core";
import {
  countEditorEdges,
  type EditorCollectionSummary,
  EditorEdgeBudget,
  RequiredNamesBudget,
  requiredNamesLimitRelation,
  selectEditorNodes,
} from "./editor-edge-budget.js";
import { eligibleLocalReference } from "./local-reference.js";
import type { SchemanAnalysisLimits } from "./types.js";

export interface SchemanEditorDocumentResult {
  readonly document: ManualEditorShapeDocument;
  readonly retainedNodes: number;
  readonly retainedEdges: number;
  readonly nodeTruncated: boolean;
  readonly edgeTruncated: boolean;
  readonly requiredNames: EditorCollectionSummary;
  readonly truncated: boolean;
}

export function schemanEditorDocument(
  source: SchemaDocument,
  limits: SchemanAnalysisLimits,
): SchemanEditorDocumentResult {
  const selection = selectEditorNodes(source, limits.maxNodes);
  const requiredNames = new RequiredNamesBudget(source, selection.ids, limits.maxEdges);
  const sourceEdges = countEditorEdges(source, selection.ids, limits.maxEdges);
  const edgeMaximum = requiredNames.structuralEdgeMaximum(limits.maxEdges, selection.ids.size);
  const budget = new EditorEdgeBudget(edgeMaximum, sourceEdges);
  const converted = new Map<string, EditorShape>();
  for (const nodeId of selection.ids) {
    const node = source.nodes[nodeId];
    if (node) {
      converted.set(
        nodeId,
        convertNode(nodeId, node, source, selection.ids, budget, requiredNames),
      );
    }
  }
  const definitions = [];
  for (const nodeId in source.nodes) {
    if (!Object.hasOwn(source.nodes, nodeId)) continue;
    const shape = converted.get(nodeId);
    if (shape) definitions.push(Object.freeze({ name: nodeId, shape }));
  }
  const requiredNamesSummary = requiredNames.summary();
  return Object.freeze({
    document: Object.freeze({
      root: reference(source.root.input.nodeId, selection.ids),
      definitions: Object.freeze(definitions),
    }),
    retainedNodes: definitions.length,
    retainedEdges: budget.used,
    nodeTruncated: selection.truncated,
    edgeTruncated: budget.truncated,
    requiredNames: requiredNamesSummary,
    truncated: selection.truncated || budget.truncated || requiredNamesSummary.truncated,
  });
}

function convertNode(
  nodeId: string,
  node: SchemaNode,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
  requiredNames: RequiredNamesBudget,
): EditorShape {
  const common = commonEvidence(nodeId, node, selected, budget, requiredNames);
  if (budget.exhausted) return { ...budget.limitNode(nodeId), ...common };
  const simple = simpleShape(node, common);
  if (simple) return simple;
  return convertConnectedNode(nodeId, node, common, document, selected, budget, requiredNames);
}

function simpleShape(node: SchemaNode, common: CommonEvidence): EditorShape | undefined {
  if (node.kind === "unknown") return { kind: "unknown", reason: node.reason, ...common };
  if (node.kind === "opaque") return { kind: "opaque", reason: node.reason, ...common };
  if (node.kind === "unconstrained") {
    return { kind: "unconstrained", domain: node.domain, ...common };
  }
  if (node.kind === "never") return { kind: "never", ...common };
  if (node.kind === "primitive") return { kind: "scalar", name: node.type, ...common };
  if (node.kind === "literal") return { kind: "literal", value: node.value, ...common };
  if (node.kind === "enum") return { kind: "enum", values: node.values, ...common };
  return undefined;
}

function convertConnectedNode(
  nodeId: string,
  node: SchemaNode,
  common: CommonEvidence,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
  requiredNames: RequiredNamesBudget,
): EditorShape {
  if (node.kind === "object") {
    return objectShape(nodeId, node, common, selected, budget, requiredNames);
  }
  if (node.kind === "array") {
    const element = edgeReference(node.items, `${nodeId}.items`, selected, budget);
    return element
      ? { kind: "array", element, ...common }
      : { ...budget.limitNode(nodeId), ...common };
  }
  if (node.kind === "tuple") return tupleShape(nodeId, node, common, selected, budget);
  if (node.kind === "record") return recordShape(nodeId, node, common, selected, budget);
  if (node.kind === "union") return unionShape(nodeId, node, common, selected, budget);
  if (node.kind === "intersection") {
    return {
      kind: "intersection",
      operands: boundedReferences(node.operands, `${nodeId}.operand`, selected, budget),
      ...common,
    };
  }
  if (node.kind === "ref") {
    return referenceShape(nodeId, node, common, document, selected, budget);
  }
  if (node.kind === "wrapper") {
    return wrapperShape(nodeId, node, common, selected, budget);
  }
  return { kind: "unknown", reason: `unsupported:${nodeId}`, ...common };
}

function objectShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "object" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
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
    ...common,
  };
}

function tupleShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "tuple" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
): EditorShape {
  const items = boundedReferences(node.items, `${nodeId}.item`, selected, budget);
  const rest = isEdgeLimit(items.at(-1))
    ? null
    : optionalEdgeReference(node.rest, `${nodeId}.rest`, selected, budget);
  return { kind: "tuple", items, ...(rest ? { rest } : {}), ...common };
}

function recordShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "record" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
): EditorShape {
  const key = edgeReference(node.key, `${nodeId}.key`, selected, budget);
  const value = key ? edgeReference(node.value, `${nodeId}.value`, selected, budget) : null;
  if (!key || !value) return { ...budget.limitNode(nodeId), ...common };
  return { kind: "record", key, value, exhaustive: node.exhaustive, ...common };
}

function unionShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "union" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
): EditorShape {
  return {
    kind: "union",
    variants: boundedReferences(node.alternatives, `${nodeId}.variant`, selected, budget),
    semantics: node.semantics,
    ...(node.discriminator === undefined ? {} : { discriminator: node.discriminator }),
    ...common,
  };
}

function referenceShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "ref" }>,
  common: CommonEvidence,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
): EditorShape {
  if (!eligibleLocalReference(nodeId, node, document)) {
    return {
      kind: "reference",
      definition: `unsupported:${nodeId}`,
      reference: node.reference,
      unresolved: node.unresolved ?? "non-local-reference",
      ...common,
    };
  }
  if (!budget.claim()) return { ...budget.limitNode(nodeId), ...common };
  if (!selected.has(node.target?.nodeId as string)) {
    return {
      kind: "unknown",
      reason: `bounded-reference:${node.reference}`,
      evidenceCode: "node-limit",
      ...common,
    };
  }
  return {
    kind: "reference",
    definition: node.target?.nodeId as string,
    reference: node.reference,
    ...common,
  };
}

function wrapperShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "wrapper" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
): EditorShape {
  const inner = edgeReference(node.inner, `${nodeId}.inner`, selected, budget);
  if (!inner) return { ...budget.limitNode(nodeId), ...common };
  return {
    kind: "wrapper",
    wrapper: node.wrapper,
    inner,
    ...(node.value === undefined ? {} : { value: node.value }),
    ...common,
  };
}

interface CommonEvidence {
  readonly sourceId: string;
  readonly annotations?: OwnedValue;
  readonly constraints?: OwnedValue;
  readonly relations: readonly EditorRelationShape[];
}

function commonEvidence(
  nodeId: string,
  node: SchemaNode,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
  requiredNames: RequiredNamesBudget,
): CommonEvidence {
  const collectionRelations = requiredNames.requiresEvidence(node)
    ? requiredNamesLimitRelation(nodeId, budget)
    : [];
  return {
    sourceId: nodeId,
    ...(node.metadata === undefined ? {} : { annotations: node.metadata }),
    ...(node.constraints === undefined ? {} : { constraints: node.constraints }),
    relations: Object.freeze([
      ...collectionRelations,
      ...applicatorRelations(nodeId, node.applicators, selected, budget),
    ]),
  };
}

function applicatorRelations(
  nodeId: string,
  applicators: Applicators | undefined,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
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
  budget: EditorEdgeBudget,
): boolean {
  for (const [key, target] of Object.entries(input ?? {})) {
    const shape = edgeReference(target, `${nodeId}.${name}.${key}`, selected, budget);
    if (!shape) return true;
    output.push({ name, key, shape });
    if (isEdgeLimit(shape)) return true;
  }
  return false;
}

function boundedReferences(
  values: readonly NodeRef[],
  source: string,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
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
  budget: EditorEdgeBudget,
): EditorShape | null {
  return value ? edgeReference(value, source, selected, budget) : null;
}

function edgeReference(
  value: NodeRef,
  source: string,
  selected: ReadonlySet<string>,
  budget: EditorEdgeBudget,
): EditorShape | null {
  if (budget.claim()) return reference(value.nodeId, selected);
  return budget.limitEdge(source);
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

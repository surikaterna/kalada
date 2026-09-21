import type { EditorRelationShape, EditorShape, ManualEditorShapeDocument } from "@kalada/host";
import type { Applicators, NodeRef, OwnedValue, SchemaDocument, SchemaNode } from "@scheman/core";
import { eligibleLocalReference } from "./local-reference.js";
import type { SchemanAnalysisLimits } from "./types.js";

export interface SchemanEditorDocumentResult {
  readonly document: ManualEditorShapeDocument;
  readonly retainedNodes: number;
  readonly truncated: boolean;
}

export function schemanEditorDocument(
  source: SchemaDocument,
  limits: SchemanAnalysisLimits,
): SchemanEditorDocumentResult {
  const selection = selectNodes(source, limits.maxNodes);
  const definitions = [];
  for (const nodeId in source.nodes) {
    if (!selection.ids.has(nodeId) || !Object.hasOwn(source.nodes, nodeId)) continue;
    const node = source.nodes[nodeId];
    if (node)
      definitions.push(
        Object.freeze({ name: nodeId, shape: convertNode(nodeId, node, source, selection.ids) }),
      );
  }
  return Object.freeze({
    document: Object.freeze({
      root: reference(source.root.input.nodeId, selection.ids),
      definitions: Object.freeze(definitions),
    }),
    retainedNodes: definitions.length,
    truncated: selection.truncated,
  });
}

function selectNodes(document: SchemaDocument, maximum: number) {
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

function convertNode(
  nodeId: string,
  node: SchemaNode,
  document: SchemaDocument,
  selected: ReadonlySet<string>,
): EditorShape {
  const common = commonEvidence(nodeId, node, selected);
  if (node.kind === "unknown") return { kind: "unknown", reason: node.reason, ...common };
  if (node.kind === "opaque") return { kind: "opaque", reason: node.reason, ...common };
  if (node.kind === "unconstrained")
    return { kind: "unconstrained", domain: node.domain, ...common };
  if (node.kind === "never") return { kind: "never", ...common };
  if (node.kind === "primitive") return { kind: "scalar", name: node.type, ...common };
  if (node.kind === "literal") return { kind: "literal", value: node.value, ...common };
  if (node.kind === "enum") return { kind: "enum", values: node.values, ...common };
  if (node.kind === "object") return objectShape(node, common, selected);
  if (node.kind === "array")
    return { kind: "array", element: reference(node.items.nodeId, selected), ...common };
  if (node.kind === "tuple") return tupleShape(node, common, selected);
  if (node.kind === "record") return recordShape(node, common, selected);
  if (node.kind === "union") return unionShape(node, common, selected);
  if (node.kind === "intersection") {
    return {
      kind: "intersection",
      operands: node.operands.map((ref) => refShape(ref, selected)),
      ...common,
    };
  }
  if (node.kind === "ref") return referenceShape(nodeId, node, common, document, selected);
  return wrapperShape(node as Extract<SchemaNode, { kind: "wrapper" }>, common, selected);
}

function objectShape(
  node: Extract<SchemaNode, { kind: "object" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
): EditorShape {
  return {
    kind: "object",
    properties: node.properties.map((property) => ({
      name: property.name,
      required: property.presence === "required",
      presence: property.presence,
      shape: reference(property.node.nodeId, selected),
    })),
    requiredNames: node.required,
    unknownKeys: node.unknownKeys,
    ...(node.additionalProperties
      ? { additionalProperties: reference(node.additionalProperties.nodeId, selected) }
      : {}),
    ...common,
  };
}

function tupleShape(
  node: Extract<SchemaNode, { kind: "tuple" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
): EditorShape {
  return {
    kind: "tuple",
    items: node.items.map((ref) => refShape(ref, selected)),
    ...(node.rest ? { rest: reference(node.rest.nodeId, selected) } : {}),
    ...common,
  };
}

function recordShape(
  node: Extract<SchemaNode, { kind: "record" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
): EditorShape {
  return {
    kind: "record",
    key: reference(node.key.nodeId, selected),
    value: reference(node.value.nodeId, selected),
    exhaustive: node.exhaustive,
    ...common,
  };
}

function unionShape(
  node: Extract<SchemaNode, { kind: "union" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
): EditorShape {
  return {
    kind: "union",
    variants: node.alternatives.map((ref) => refShape(ref, selected)),
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
  node: Extract<SchemaNode, { kind: "wrapper" }>,
  common: CommonEvidence,
  selected: ReadonlySet<string>,
): EditorShape {
  return {
    kind: "wrapper",
    wrapper: node.wrapper,
    inner: reference(node.inner.nodeId, selected),
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
): CommonEvidence {
  return {
    sourceId: nodeId,
    ...(node.metadata === undefined ? {} : { annotations: node.metadata }),
    ...(node.constraints === undefined ? {} : { constraints: node.constraints }),
    relations: applicatorRelations(node.applicators, selected),
  };
}

function applicatorRelations(
  applicators: Applicators | undefined,
  selected: ReadonlySet<string>,
): readonly EditorRelationShape[] {
  if (!applicators) return Object.freeze([]);
  const output: EditorRelationShape[] = [];
  for (const name of ["if", "then", "else", "not", "contains", "propertyNames"] as const) {
    const target = applicators[name];
    if (target) output.push({ name, shape: reference(target.nodeId, selected) });
  }
  addKeyedRelations("patternProperties", applicators.patternProperties, output, selected);
  addKeyedRelations("dependentSchemas", applicators.dependentSchemas, output, selected);
  return Object.freeze(output);
}

function addKeyedRelations(
  name: string,
  input: Readonly<Record<string, NodeRef>> | undefined,
  output: EditorRelationShape[],
  selected: ReadonlySet<string>,
): void {
  for (const [key, target] of Object.entries(input ?? {})) {
    output.push({ name, key, shape: reference(target.nodeId, selected) });
  }
}

function refShape(ref: NodeRef, selected: ReadonlySet<string>): EditorShape {
  return reference(ref.nodeId, selected);
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

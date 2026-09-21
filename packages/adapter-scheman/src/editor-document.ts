import type { EditorRelationShape, EditorShape, ManualEditorShapeDocument } from "@kalada/host";
import type { Applicators, NodeRef, OwnedValue, SchemaDocument, SchemaNode } from "@scheman/core";

export function schemanEditorDocument(document: SchemaDocument): ManualEditorShapeDocument {
  const definitions = Object.entries(document.nodes).map(([nodeId, node]) =>
    Object.freeze({ name: nodeId, shape: convertNode(nodeId, node) }),
  );
  return Object.freeze({
    root: reference(document.root.input.nodeId),
    definitions: Object.freeze(definitions),
  });
}

function convertNode(nodeId: string, node: SchemaNode): EditorShape {
  const common = commonEvidence(nodeId, node);
  if (node.kind === "unknown") return { kind: "unknown", reason: node.reason, ...common };
  if (node.kind === "opaque") return { kind: "opaque", reason: node.reason, ...common };
  if (node.kind === "unconstrained")
    return { kind: "unconstrained", domain: node.domain, ...common };
  if (node.kind === "never") return { kind: "never", ...common };
  if (node.kind === "primitive") return { kind: "scalar", name: node.type, ...common };
  if (node.kind === "literal") return { kind: "literal", value: node.value, ...common };
  if (node.kind === "enum") return { kind: "enum", values: node.values, ...common };
  if (node.kind === "object") return objectShape(node, common);
  if (node.kind === "array")
    return { kind: "array", element: reference(node.items.nodeId), ...common };
  if (node.kind === "tuple") return tupleShape(node, common);
  if (node.kind === "record") return recordShape(node, common);
  if (node.kind === "union") return unionShape(node, common);
  if (node.kind === "intersection") {
    return { kind: "intersection", operands: node.operands.map(refShape), ...common };
  }
  if (node.kind === "ref") return referenceShape(nodeId, node, common);
  return wrapperShape(node as Extract<SchemaNode, { kind: "wrapper" }>, common);
}

function objectShape(
  node: Extract<SchemaNode, { kind: "object" }>,
  common: CommonEvidence,
): EditorShape {
  return {
    kind: "object",
    properties: node.properties.map((property) => ({
      name: property.name,
      required: property.presence === "required",
      presence: property.presence,
      shape: reference(property.node.nodeId),
    })),
    requiredNames: node.required,
    unknownKeys: node.unknownKeys,
    ...(node.additionalProperties
      ? { additionalProperties: reference(node.additionalProperties.nodeId) }
      : {}),
    ...common,
  };
}

function tupleShape(
  node: Extract<SchemaNode, { kind: "tuple" }>,
  common: CommonEvidence,
): EditorShape {
  return {
    kind: "tuple",
    items: node.items.map(refShape),
    ...(node.rest ? { rest: reference(node.rest.nodeId) } : {}),
    ...common,
  };
}

function recordShape(
  node: Extract<SchemaNode, { kind: "record" }>,
  common: CommonEvidence,
): EditorShape {
  return {
    kind: "record",
    key: reference(node.key.nodeId),
    value: reference(node.value.nodeId),
    exhaustive: node.exhaustive,
    ...common,
  };
}

function unionShape(
  node: Extract<SchemaNode, { kind: "union" }>,
  common: CommonEvidence,
): EditorShape {
  return {
    kind: "union",
    variants: node.alternatives.map(refShape),
    semantics: node.semantics,
    ...(node.discriminator === undefined ? {} : { discriminator: node.discriminator }),
    ...common,
  };
}

function referenceShape(
  nodeId: string,
  node: Extract<SchemaNode, { kind: "ref" }>,
  common: CommonEvidence,
): EditorShape {
  return {
    kind: "reference",
    definition: node.target?.nodeId ?? `unresolved:${nodeId}`,
    reference: node.reference,
    ...(node.unresolved ? { unresolved: node.unresolved } : {}),
    ...common,
  };
}

function wrapperShape(
  node: Extract<SchemaNode, { kind: "wrapper" }>,
  common: CommonEvidence,
): EditorShape {
  return {
    kind: "wrapper",
    wrapper: node.wrapper,
    inner: reference(node.inner.nodeId),
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

function commonEvidence(nodeId: string, node: SchemaNode): CommonEvidence {
  return {
    sourceId: nodeId,
    ...(node.metadata === undefined ? {} : { annotations: node.metadata }),
    ...(node.constraints === undefined ? {} : { constraints: node.constraints }),
    relations: applicatorRelations(node.applicators),
  };
}

function applicatorRelations(applicators?: Applicators): readonly EditorRelationShape[] {
  if (!applicators) return Object.freeze([]);
  const output: EditorRelationShape[] = [];
  for (const name of ["if", "then", "else", "not", "contains", "propertyNames"] as const) {
    const target = applicators[name];
    if (target) output.push({ name, shape: reference(target.nodeId) });
  }
  addKeyedRelations("patternProperties", applicators.patternProperties, output);
  addKeyedRelations("dependentSchemas", applicators.dependentSchemas, output);
  return Object.freeze(output);
}

function addKeyedRelations(
  name: string,
  input: Readonly<Record<string, NodeRef>> | undefined,
  output: EditorRelationShape[],
): void {
  for (const [key, target] of Object.entries(input ?? {})) {
    output.push({ name, key, shape: reference(target.nodeId) });
  }
}

function refShape(ref: NodeRef): EditorShape {
  return reference(ref.nodeId);
}

function reference(definition: string): EditorShape {
  return { kind: "reference", definition };
}

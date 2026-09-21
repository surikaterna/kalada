import type { SemanticTypeResult } from "@kalada/host";
import type { SchemaDocument, SchemaNode } from "@scheman/core";
import type { SchemanAdapterDiagnostic } from "./types.js";

type SemanticType = Extract<SemanticTypeResult, { ok: true }>["value"];
type ProjectionResult = Readonly<{
  readonly type: SemanticType;
  readonly diagnostics: readonly SchemanAdapterDiagnostic[];
}>;

const primitive = (name: "null" | "boolean" | "number" | "string" | "json"): SemanticType =>
  Object.freeze({ kind: "primitive-type", name });

export function projectOutput(document: SchemaDocument): ProjectionResult {
  const diagnostics: SchemanAdapterDiagnostic[] = [];
  const type = project(document.root.output.nodeId, document, new Set(), diagnostics);
  if (type === "dynamic") {
    diagnostics.push(
      adapterWarning("SCHEMAN_ADAPTER_DYNAMIC_PROJECTION", document.root.output.nodeId),
    );
  }
  return Object.freeze({ type, diagnostics: Object.freeze(diagnostics) });
}

function project(
  nodeId: string,
  document: SchemaDocument,
  active: Set<string>,
  diagnostics: SchemanAdapterDiagnostic[],
): SemanticType {
  const node = document.nodes[nodeId];
  if (!node || active.has(nodeId)) return dynamicWithEvidence(nodeId, diagnostics);
  active.add(nodeId);
  const output = projectNode(node, nodeId, document, active, diagnostics);
  active.delete(nodeId);
  return output;
}

function projectNode(
  node: SchemaNode,
  nodeId: string,
  document: SchemaDocument,
  active: Set<string>,
  diagnostics: SchemanAdapterDiagnostic[],
): SemanticType {
  if (hasApplicators(node)) {
    return dynamicWithEvidence(nodeId, diagnostics);
  }
  const atomic = atomicProjection(node);
  if (atomic !== null) return atomic;
  if (node.kind === "array")
    return arrayProjection(node.items.nodeId, document, active, diagnostics);
  if (node.kind === "object" || node.kind === "record" || node.kind === "tuple") {
    return isJsonSafe(nodeId, document, new Set())
      ? primitive("json")
      : dynamicWithEvidence(nodeId, diagnostics);
  }
  const advanced = advancedProjection(node, document, active, diagnostics);
  if (advanced !== null) return advanced;
  if (node.kind === "unconstrained" && node.domain === "json") return primitive("json");
  return "dynamic";
}

function advancedProjection(
  node: SchemaNode,
  document: SchemaDocument,
  active: Set<string>,
  diagnostics: SchemanAdapterDiagnostic[],
): SemanticType | null {
  if (node.kind === "union")
    return sharedProjection(node.alternatives, document, active, diagnostics);
  if (node.kind === "intersection")
    return sharedProjection(node.operands, document, active, diagnostics);
  if (node.kind === "ref") return refProjection(node, document, active, diagnostics);
  if (node.kind === "wrapper" && (node.wrapper === "readonly" || node.wrapper === "brand")) {
    return project(node.inner.nodeId, document, active, diagnostics);
  }
  return null;
}

function atomicProjection(node: SchemaNode): SemanticType | null {
  if (node.kind === "primitive") return primitiveProjection(node.type);
  if (node.kind === "literal") return literalProjection(node.value);
  if (node.kind === "enum") return enumProjection(node.values);
  return null;
}

function primitiveProjection(
  type: Extract<SchemaNode, { kind: "primitive" }>["type"],
): SemanticType {
  if (type === "null" || type === "boolean" || type === "string") return primitive(type);
  return type === "number" || type === "integer" ? primitive("number") : "dynamic";
}

function literalProjection(value: unknown): SemanticType {
  const domain = primitiveDomain(value);
  return domain ? primitive(domain) : "dynamic";
}

function enumProjection(values: readonly unknown[]): SemanticType {
  const domains = new Set(values.map(primitiveDomain));
  const [domain] = domains;
  return domains.size === 1 && domain ? primitive(domain) : "dynamic";
}

function arrayProjection(
  nodeId: string,
  document: SchemaDocument,
  active: Set<string>,
  diagnostics: SchemanAdapterDiagnostic[],
): SemanticType {
  const element = project(nodeId, document, active, diagnostics);
  return element === "dynamic" ? "dynamic" : Object.freeze({ kind: "array-type", element });
}

function sharedProjection(
  refs: readonly { readonly nodeId: string }[],
  document: SchemaDocument,
  active: Set<string>,
  diagnostics: SchemanAdapterDiagnostic[],
): SemanticType {
  if (refs.length === 0) return "dynamic";
  const projected = refs.map((ref) => project(ref.nodeId, document, active, diagnostics));
  const first = projected[0];
  if (first === undefined || first === "dynamic") return "dynamic";
  return projected.every((item) => sameType(item, first)) ? first : "dynamic";
}

function refProjection(
  node: Extract<SchemaNode, { kind: "ref" }>,
  document: SchemaDocument,
  active: Set<string>,
  diagnostics: SchemanAdapterDiagnostic[],
): SemanticType {
  if (!node.target || !document.nodes[node.target.nodeId]) {
    diagnostics.push(adapterWarning("SCHEMAN_ADAPTER_UNRESOLVED_ROOT", node.target?.nodeId));
    return "dynamic";
  }
  return project(node.target.nodeId, document, active, diagnostics);
}

function isJsonSafe(nodeId: string, document: SchemaDocument, active: Set<string>): boolean {
  if (active.has(nodeId)) return true;
  const node = document.nodes[nodeId];
  if (!node || hasApplicators(node)) return false;
  active.add(nodeId);
  const safe = jsonSafeNode(node, document, active);
  active.delete(nodeId);
  return safe;
}

function jsonSafeNode(node: SchemaNode, document: SchemaDocument, active: Set<string>): boolean {
  const atomic = atomicJsonSafety(node);
  if (atomic !== null) return atomic;
  if (node.kind === "array") return isJsonSafe(node.items.nodeId, document, active);
  if (node.kind === "tuple")
    return refsSafe([...node.items, ...(node.rest ? [node.rest] : [])], document, active);
  if (node.kind === "object") return objectSafe(node, document, active);
  if (node.kind === "record") return recordSafe(node, document, active);
  if (node.kind === "union") return refsSafe(node.alternatives, document, active);
  if (node.kind === "intersection") return refsSafe(node.operands, document, active);
  if (node.kind === "ref")
    return Boolean(node.target && isJsonSafe(node.target.nodeId, document, active));
  if (node.kind === "wrapper")
    return (
      ["readonly", "brand"].includes(node.wrapper) &&
      isJsonSafe(node.inner.nodeId, document, active)
    );
  return false;
}

function atomicJsonSafety(node: SchemaNode): boolean | null {
  if (node.kind === "primitive") {
    return ["null", "boolean", "number", "integer", "string"].includes(node.type);
  }
  if (node.kind === "literal") return primitiveDomain(node.value) !== null;
  if (node.kind === "enum") return node.values.every((value) => isJsonValue(value));
  if (node.kind === "unconstrained") return node.domain === "json";
  return null;
}

function objectSafe(
  node: Extract<SchemaNode, { kind: "object" }>,
  document: SchemaDocument,
  active: Set<string>,
): boolean {
  const refs = node.properties.map((property) => property.node);
  if (node.additionalProperties) refs.push(node.additionalProperties);
  return refsSafe(refs, document, active);
}

function recordSafe(
  node: Extract<SchemaNode, { kind: "record" }>,
  document: SchemaDocument,
  active: Set<string>,
): boolean {
  return (
    sameType(project(node.key.nodeId, document, new Set(), []), primitive("string")) &&
    isJsonSafe(node.value.nodeId, document, active)
  );
}

function refsSafe(
  refs: readonly { readonly nodeId: string }[],
  document: SchemaDocument,
  active: Set<string>,
): boolean {
  return refs.every((ref) => isJsonSafe(ref.nodeId, document, active));
}

function primitiveDomain(value: unknown): "null" | "boolean" | "number" | "string" | null {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return typeof value === "number" && Number.isFinite(value) ? "number" : null;
}

function isJsonValue(value: unknown): boolean {
  if (primitiveDomain(value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(isJsonValue);
}

function sameType(left: SemanticType, right: SemanticType): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dynamicWithEvidence(nodeId: string, diagnostics: SchemanAdapterDiagnostic[]): "dynamic" {
  diagnostics.push(adapterWarning("SCHEMAN_ADAPTER_UNSUPPORTED_EVIDENCE", nodeId));
  return "dynamic";
}

function adapterWarning(
  code: SchemanAdapterDiagnostic["code"],
  nodeId?: string,
): SchemanAdapterDiagnostic {
  return Object.freeze({
    code,
    severity: "warning",
    side: "output",
    sourcePointer: "",
    ...(nodeId ? { nodeId } : {}),
  });
}

function hasApplicators(node: SchemaNode): boolean {
  const value = node.applicators;
  if (!value) return false;
  if (value.if || value.then || value.else || value.not || value.contains || value.propertyNames) {
    return true;
  }
  return (
    Object.keys(value.patternProperties ?? {}).length > 0 ||
    Object.keys(value.dependentSchemas ?? {}).length > 0
  );
}

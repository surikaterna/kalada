import type { SemanticTypeResult } from "@kalada/host";
import type { NodeRef, SchemaDocument, SchemaNode } from "@scheman/core";
import { eligibleLocalReference } from "./local-reference.js";
import type { SchemanAdapterDiagnostic, SchemanAnalysisLimits } from "./types.js";

type SemanticType = Extract<SemanticTypeResult, { ok: true }>["value"];
interface ProjectionState {
  readonly type: SemanticType;
  readonly depth: number;
}
interface AnalysisGraph {
  readonly nodes: ReadonlyMap<string, SchemaNode>;
  readonly bounded: boolean;
}
type ProjectionResult = Readonly<{
  readonly type: SemanticType;
  readonly diagnostics: readonly SchemanAdapterDiagnostic[];
}>;

const primitive = (name: "null" | "boolean" | "number" | "string" | "json"): SemanticType =>
  Object.freeze({ kind: "primitive-type", name });

export function projectOutput(
  document: SchemaDocument,
  limits: SchemanAnalysisLimits,
): ProjectionResult {
  const rootId = document.root.output.nodeId;
  const graph = collectGraph(rootId, document, limits);
  if (graph.bounded) return boundedProjection(rootId);
  const safe = jsonSafety(graph, document);
  const states = projectionStates(graph, safe, document, limits.maxTypeDepth);
  const type = states.get(rootId)?.type ?? "dynamic";
  return Object.freeze({ type, diagnostics: projectionDiagnostics(type, rootId) });
}

function collectGraph(
  rootId: string,
  document: SchemaDocument,
  limits: SchemanAnalysisLimits,
): AnalysisGraph {
  const nodes = new Map<string, SchemaNode>();
  const pending = [rootId];
  let edges = 0;
  let bounded = false;
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || nodes.has(nodeId)) continue;
    if (nodes.size >= limits.maxNodes) {
      bounded = true;
      break;
    }
    const node = document.nodes[nodeId];
    if (!node) continue;
    nodes.set(nodeId, node);
    const children = projectionChildren(nodeId, node, document);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      edges += 1;
      if (edges > limits.maxEdges) {
        bounded = true;
        break;
      }
      pending.push(children[index] as string);
    }
    if (bounded) break;
  }
  return Object.freeze({ nodes, bounded });
}

function projectionChildren(nodeId: string, node: SchemaNode, document: SchemaDocument): string[] {
  if (hasApplicators(node)) return [];
  if (node.kind === "object") {
    return [
      ...node.properties.map((property) => property.node.nodeId),
      ...(node.additionalProperties ? [node.additionalProperties.nodeId] : []),
    ];
  }
  if (node.kind === "array") return [node.items.nodeId];
  if (node.kind === "tuple") return refs([...node.items, ...(node.rest ? [node.rest] : [])]);
  if (node.kind === "record") return [node.key.nodeId, node.value.nodeId];
  if (node.kind === "union") return refs(node.alternatives);
  if (node.kind === "intersection") return refs(node.operands);
  if (node.kind === "wrapper") return [node.inner.nodeId];
  if (node.kind === "ref" && eligibleLocalReference(nodeId, node, document)) {
    return [node.target?.nodeId as string];
  }
  return [];
}

function jsonSafety(graph: AnalysisGraph, document: SchemaDocument): ReadonlyMap<string, boolean> {
  const safe = new Map<string, boolean>();
  const stringKeys = stringKeyDomains(graph, document);
  for (const [nodeId, node] of graph.nodes) safe.set(nodeId, jsonCandidate(nodeId, node, document));
  for (let pass = 0; pass < graph.nodes.size; pass += 1) {
    let changed = false;
    for (const [nodeId, node] of graph.nodes) {
      if (!safe.get(nodeId) || jsonDependenciesSafe(nodeId, node, safe, stringKeys, document))
        continue;
      safe.set(nodeId, false);
      changed = true;
    }
    if (!changed) break;
  }
  return safe;
}

function jsonCandidate(nodeId: string, node: SchemaNode, document: SchemaDocument): boolean {
  if (hasApplicators(node)) return false;
  if (node.kind === "primitive") {
    return ["null", "boolean", "number", "integer", "string"].includes(node.type);
  }
  if (node.kind === "literal") return isJsonValue(node.value);
  if (node.kind === "enum") return node.values.every(isJsonValue);
  if (node.kind === "unconstrained") return node.domain === "json";
  if (node.kind === "ref") return eligibleLocalReference(nodeId, node, document);
  if (node.kind === "wrapper") return node.wrapper === "readonly" || node.wrapper === "brand";
  return ["object", "array", "tuple", "record", "union", "intersection"].includes(node.kind);
}

function jsonDependenciesSafe(
  nodeId: string,
  node: SchemaNode,
  safe: ReadonlyMap<string, boolean>,
  stringKeys: ReadonlyMap<string, boolean>,
  document: SchemaDocument,
): boolean {
  if (node.kind === "object") return objectDependenciesSafe(node, safe);
  if (node.kind === "array") return safe.get(node.items.nodeId) === true;
  if (node.kind === "tuple")
    return refsSafe([...node.items, ...(node.rest ? [node.rest] : [])], safe);
  if (node.kind === "record") {
    return stringKeys.get(node.key.nodeId) === true && safe.get(node.value.nodeId) === true;
  }
  if (node.kind === "union") return refsSafe(node.alternatives, safe);
  if (node.kind === "intersection") return refsSafe(node.operands, safe);
  if (node.kind === "wrapper") return safe.get(node.inner.nodeId) === true;
  if (node.kind === "ref" && eligibleLocalReference(nodeId, node, document)) {
    return safe.get(node.target?.nodeId as string) === true;
  }
  return true;
}

function objectDependenciesSafe(
  node: Extract<SchemaNode, { kind: "object" }>,
  safe: ReadonlyMap<string, boolean>,
): boolean {
  if (!node.properties.every((property) => safe.get(property.node.nodeId) === true)) return false;
  const additionalSafe = node.additionalProperties
    ? safe.get(node.additionalProperties.nodeId) === true
    : false;
  if (node.unknownKeys === "schema") return additionalSafe;
  if (node.unknownKeys === "passthrough" || node.unknownKeys === "unknown") return additionalSafe;
  return !node.additionalProperties || additionalSafe;
}

function stringKeyDomains(
  graph: AnalysisGraph,
  document: SchemaDocument,
): ReadonlyMap<string, boolean> {
  const output = new Map<string, boolean>();
  for (const [nodeId, node] of graph.nodes) output.set(nodeId, directStringDomain(node));
  for (let pass = 0; pass < graph.nodes.size; pass += 1) {
    let changed = false;
    for (const [nodeId, node] of graph.nodes) {
      if (output.get(nodeId) || !derivedStringDomain(nodeId, node, output, document)) continue;
      output.set(nodeId, true);
      changed = true;
    }
    if (!changed) break;
  }
  return output;
}

function directStringDomain(node: SchemaNode): boolean {
  if (node.kind === "primitive") return node.type === "string";
  if (node.kind === "literal") return typeof node.value === "string";
  return (
    node.kind === "enum" &&
    node.values.length > 0 &&
    node.values.every((item) => typeof item === "string")
  );
}

function derivedStringDomain(
  nodeId: string,
  node: SchemaNode,
  domains: ReadonlyMap<string, boolean>,
  document: SchemaDocument,
): boolean {
  if (node.kind === "wrapper" && (node.wrapper === "readonly" || node.wrapper === "brand")) {
    return domains.get(node.inner.nodeId) === true;
  }
  if (node.kind === "ref" && eligibleLocalReference(nodeId, node, document)) {
    return domains.get(node.target?.nodeId as string) === true;
  }
  if (node.kind === "union") return node.alternatives.every((ref) => domains.get(ref.nodeId));
  if (node.kind === "intersection") return node.operands.every((ref) => domains.get(ref.nodeId));
  return false;
}

function projectionStates(
  graph: AnalysisGraph,
  safe: ReadonlyMap<string, boolean>,
  document: SchemaDocument,
  maxDepth: number,
): ReadonlyMap<string, ProjectionState> {
  const states = new Map<string, ProjectionState>();
  for (const [nodeId, node] of graph.nodes) {
    const direct = directProjection(node, safe.get(nodeId) === true);
    if (direct) states.set(nodeId, direct);
  }
  for (let pass = 0; pass < graph.nodes.size; pass += 1) {
    let changed = false;
    for (const [nodeId, node] of graph.nodes) {
      if (states.has(nodeId)) continue;
      const derived = derivedProjection(nodeId, node, states, document, maxDepth);
      if (!derived) continue;
      states.set(nodeId, derived);
      changed = true;
    }
    if (!changed) break;
  }
  return states;
}

function directProjection(node: SchemaNode, jsonSafe: boolean): ProjectionState | null {
  if (hasApplicators(node)) return null;
  if (node.kind === "primitive") return state(primitiveProjection(node.type));
  if (node.kind === "literal") return state(literalProjection(node.value));
  if (node.kind === "enum") return state(enumProjection(node.values));
  if (node.kind === "unconstrained" && node.domain === "json") return state(primitive("json"));
  if (["object", "record", "tuple"].includes(node.kind) && jsonSafe)
    return state(primitive("json"));
  return null;
}

function derivedProjection(
  nodeId: string,
  node: SchemaNode,
  states: ReadonlyMap<string, ProjectionState>,
  document: SchemaDocument,
  maxDepth: number,
): ProjectionState | null {
  if (node.kind === "array") return arrayState(states.get(node.items.nodeId), maxDepth);
  if (node.kind === "union") return sharedState(node.alternatives, states);
  if (node.kind === "intersection") return sharedState(node.operands, states);
  if (node.kind === "wrapper" && (node.wrapper === "readonly" || node.wrapper === "brand")) {
    return states.get(node.inner.nodeId) ?? null;
  }
  if (node.kind === "ref" && eligibleLocalReference(nodeId, node, document)) {
    return states.get(node.target?.nodeId as string) ?? null;
  }
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

function arrayState(
  element: ProjectionState | undefined,
  maxDepth: number,
): ProjectionState | null {
  if (!element || element.type === "dynamic" || element.depth >= maxDepth) return null;
  return Object.freeze({
    type: Object.freeze({ kind: "array-type", element: element.type }),
    depth: element.depth + 1,
  });
}

function sharedState(
  refs: readonly NodeRef[],
  states: ReadonlyMap<string, ProjectionState>,
): ProjectionState | null {
  const values = refs.map((ref) => states.get(ref.nodeId));
  const first = values[0];
  if (!first || first.type === "dynamic" || values.some((item) => !item)) return null;
  return values.every((item) => sameType(item?.type, first.type)) ? first : null;
}

function state(type: SemanticType): ProjectionState | null {
  return type === "dynamic" ? null : Object.freeze({ type, depth: 0 });
}

function refsSafe(values: readonly NodeRef[], safe: ReadonlyMap<string, boolean>): boolean {
  return values.every((ref) => safe.get(ref.nodeId) === true);
}

function refs(values: readonly NodeRef[]): string[] {
  return values.map((value) => value.nodeId);
}

function primitiveDomain(value: unknown): "null" | "boolean" | "number" | "string" | null {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return typeof value === "number" && Number.isFinite(value) ? "number" : null;
}

function isJsonValue(input: unknown): boolean {
  const pending = [input];
  let visits = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    visits += 1;
    if (visits > 10_000) return false;
    if (primitiveDomain(value)) continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (typeof value !== "object" || value === null) return false;
    pending.push(...Object.values(value));
  }
  return true;
}

function hasApplicators(node: SchemaNode): boolean {
  const value = node.applicators;
  if (!value) return false;
  if (value.if || value.then || value.else || value.not || value.contains || value.propertyNames)
    return true;
  return (
    Object.keys(value.patternProperties ?? {}).length > 0 ||
    Object.keys(value.dependentSchemas ?? {}).length > 0
  );
}

function sameType(left: SemanticType | undefined, right: SemanticType): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function projectionDiagnostics(
  type: SemanticType,
  nodeId: string,
): readonly SchemanAdapterDiagnostic[] {
  if (type !== "dynamic") return Object.freeze([]);
  return Object.freeze([
    warning("SCHEMAN_ADAPTER_UNSUPPORTED_EVIDENCE", nodeId),
    warning("SCHEMAN_ADAPTER_DYNAMIC_PROJECTION", nodeId),
  ]);
}

function boundedProjection(nodeId: string): ProjectionResult {
  return Object.freeze({
    type: "dynamic",
    diagnostics: Object.freeze([
      warning("SCHEMAN_ADAPTER_ANALYSIS_LIMIT", nodeId),
      warning("SCHEMAN_ADAPTER_DYNAMIC_PROJECTION", nodeId),
    ]),
  });
}

function warning(code: SchemanAdapterDiagnostic["code"], nodeId: string): SchemanAdapterDiagnostic {
  return Object.freeze({ code, severity: "warning", side: "output", sourcePointer: "", nodeId });
}

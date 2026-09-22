import type { EditorEdge, EditorGraph, EditorNode } from "@kalada/host";
import { GENERATION_BOUNDS } from "./contract.js";

export interface CanonicalInputShape {
  readonly format: "demo-input-candidate-v1";
  readonly root: number;
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
  readonly bounds: typeof GENERATION_BOUNDS;
}

export function canonicalInputShape(
  graph: EditorGraph,
  bindingId = "demo:data",
): CanonicalInputShape {
  const root = graph.roots.find((entry) => entry.bindingId === bindingId);
  if (!root) throw new Error("GENERATION_ROOT_MISSING");
  return canonicalNodeShape(graph, root.nodeId);
}

export function canonicalNodeShape(graph: EditorGraph, rootId: string): CanonicalInputShape {
  const source = new Map(graph.nodes.map((node) => [node.id, node]));
  const indices = new Map<string, number>();
  const nodes: Record<string, unknown>[] = [];
  const visit = (id: string): number => {
    const known = indices.get(id);
    if (known !== undefined) return known;
    const node = source.get(id);
    if (!node) throw new Error("GENERATION_NODE_MISSING");
    const index = nodes.length;
    indices.set(id, index);
    nodes.push({ pending: true });
    nodes[index] = encodeNode(node, visit);
    return index;
  };
  return deepFreeze({
    format: "demo-input-candidate-v1",
    bounds: { ...GENERATION_BOUNDS },
    root: visit(rootId),
    nodes,
  });
}

export function canonicalShapeBytes(shape: CanonicalInputShape): string {
  return canonicalJson(shape);
}

function encodeNode(node: EditorNode, visit: (id: string) => number): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: node.kind,
    availability: node.availability,
    evidence: [...new Set(node.evidence.map((entry) => entry.code))].sort(),
    ...(node.constraints === undefined ? {} : { constraints: passive(node.constraints) }),
  };
  if (node.kind === "scalar") return { ...base, name: node.name };
  if (node.kind === "literal") return { ...base, value: passive(node.value) };
  if (node.kind === "enum") return { ...base, values: passive(node.values) };
  return encodeComposite(base, node, visit);
}

function encodeComposite(
  base: Record<string, unknown>,
  node: EditorNode,
  visit: (id: string) => number,
): Record<string, unknown> {
  if (node.kind === "object") return encodeObject(base, node, visit);
  if (node.kind === "array") return { ...base, element: edge(node.element, visit) };
  if (node.kind === "tuple")
    return {
      ...base,
      items: node.items.map((item) => edge(item, visit)),
      ...(node.rest ? { rest: edge(node.rest, visit) } : {}),
    };
  if (node.kind === "union")
    return {
      ...base,
      semantics: node.semantics ?? "union",
      variants: node.variants.map((item) => edge(item, visit)),
    };
  if (node.kind === "intersection")
    return { ...base, operands: node.operands.map((item) => edge(item, visit)) };
  if (node.kind === "reference")
    return {
      ...base,
      status: node.status,
      ...(node.target ? { target: edge(node.target, visit) } : {}),
    };
  if (node.kind === "wrapper")
    return { ...base, wrapper: node.wrapper, inner: edge(node.inner, visit) };
  if (node.kind === "record")
    return {
      ...base,
      key: edge(node.key, visit),
      value: edge(node.value, visit),
      exhaustive: node.exhaustive,
    };
  if (node.kind === "unconstrained") return { ...base, domain: node.domain };
  return base;
}

function encodeObject(
  base: Record<string, unknown>,
  node: Extract<EditorNode, { kind: "object" }>,
  visit: (id: string) => number,
) {
  const properties = [...node.properties]
    .sort((left, right) => compare(left.name, right.name))
    .map((item) => ({
      name: item.name,
      required: item.required,
      presence: item.presence ?? (item.required ? "required" : "optional"),
      edge: edge(item, visit),
    }));
  return {
    ...base,
    properties,
    ...(node.additionalProperties
      ? { additionalProperties: edge(node.additionalProperties, visit) }
      : {}),
  };
}

function edge(value: EditorEdge, visit: (id: string) => number) {
  return { target: visit(value.nodeId), cycle: value.cycle };
}
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function passive(value: unknown): unknown {
  return JSON.parse(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) return "0";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

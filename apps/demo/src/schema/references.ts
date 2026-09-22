import { SchemaAdmissionError, type SchemaEdge } from "./admission.js";
import { DEMO_LIMITS } from "./limits.js";

export function analyzeReferences(
  root: unknown,
  locations: Map<string, unknown>,
  edges: SchemaEdge[],
): number {
  resolveReferences(root, locations, edges);
  const graph = edgeMap(edges.filter((edge) => !edge.consuming));
  rejectCycles(locations, graph);
  return countPaths(locations, graph);
}

function resolveReferences(
  root: unknown,
  locations: Map<string, unknown>,
  edges: SchemaEdge[],
): void {
  for (const [pointer, value] of locations) {
    if (!plainRecord(value) || value.$ref === undefined) continue;
    const target = localReference(value.$ref, pointer);
    if (!locations.has(target) || !isSchema(readPointer(root, target))) {
      throw new SchemaAdmissionError("SCHEMA_REF_UNRESOLVED", join(pointer, "$ref"));
    }
    edges.push({ from: pointer, to: target, consuming: false });
  }
  if (edges.length > DEMO_LIMITS.schemaEdges) throw new SchemaAdmissionError("SCHEMA_EDGE_LIMIT");
}

function localReference(value: unknown, pointer: string): string {
  if (typeof value !== "string" || (value !== "#" && !value.startsWith("#/"))) {
    throw new SchemaAdmissionError("SCHEMA_REF_EXTERNAL", join(pointer, "$ref"));
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.slice(1));
  } catch {
    throw new SchemaAdmissionError("SCHEMA_REF_ENCODING", pointer);
  }
  const segments = decoded === "" ? [] : decoded.slice(1).split("/");
  validateSegments(segments, pointer);
  return segments.length === 0 ? "" : `/${segments.map(canonicalSegment).join("/")}`;
}

function validateSegments(segments: string[], pointer: string): void {
  for (const segment of segments) {
    if (/~(?![01])/u.test(segment)) throw new SchemaAdmissionError("SCHEMA_REF_ENCODING", pointer);
  }
}

function canonicalSegment(value: string): string {
  return value
    .replaceAll("~1", "/")
    .replaceAll("~0", "~")
    .replaceAll("~", "~0")
    .replaceAll("/", "~1");
}

function rejectCycles(locations: Map<string, unknown>, graph: Map<string, string[]>): void {
  const status = new Map<string, "active" | "done">();
  const visit = (node: string): void => {
    if (status.get(node) === "active") {
      throw new SchemaAdmissionError("SCHEMA_NONCONSUMING_CYCLE", node);
    }
    if (status.get(node) === "done") return;
    status.set(node, "active");
    for (const target of graph.get(node) ?? []) visit(target);
    status.set(node, "done");
  };
  for (const start of locations.keys()) visit(start);
}

function countPaths(locations: Map<string, unknown>, graph: Map<string, string[]>): number {
  const memo = new Map<string, number>();
  const visit = (node: string): number => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    let paths = 1;
    for (const target of graph.get(node) ?? []) paths = saturatedAdd(paths, visit(target));
    memo.set(node, paths);
    return paths;
  };
  let maximum = visit("");
  for (const node of locations.keys()) maximum = Math.max(maximum, visit(node));
  return maximum;
}

function edgeMap(edges: SchemaEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) map.set(edge.from, [...(map.get(edge.from) ?? []), edge.to]);
  return map;
}

function readPointer(root: unknown, pointer: string): unknown {
  let value = root;
  if (pointer === "") return value;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function isSchema(value: unknown): boolean {
  return typeof value === "boolean" || plainRecord(value);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function join(parent: string, key: string): string {
  return `${parent}/${key}`;
}

function saturatedAdd(left: number, right: number): number {
  return Math.min(DEMO_LIMITS.validationWork + 1, left + right);
}

import type { EditorEdge, EditorNode } from "@kalada/host";
import type { CandidatePresence, ToolingEvidence } from "./contracts.js";

export const MAX_GRAPH_ITEMS = 256;

export interface FieldEntry {
  readonly name: string;
  readonly presence: CandidatePresence;
}

export interface FieldCollection {
  readonly entries: readonly FieldEntry[];
  readonly evidence: readonly ToolingEvidence[];
  readonly certain: boolean;
  readonly limited: boolean;
}

export function fieldEntries(
  node: EditorNode | undefined,
  nodeIndex: ReadonlyMap<string, EditorNode>,
): FieldCollection {
  if (node?.kind === "object") return objectFields(node);
  if (node?.kind === "record") return recordFields(node.key, nodeIndex);
  return { entries: [], evidence: [], certain: true, limited: false };
}

function objectFields(node: Extract<EditorNode, { kind: "object" }>): FieldCollection {
  const limited = node.properties.length > MAX_GRAPH_ITEMS;
  const entries = node.properties.slice(0, MAX_GRAPH_ITEMS).map((property) => ({
    name: property.name,
    presence: presenceOf(property),
  }));
  return {
    entries,
    evidence: limited ? [limitEvidence(node.path)] : [],
    certain: !limited,
    limited,
  };
}

function recordFields(
  edge: EditorEdge,
  nodeIndex: ReadonlyMap<string, EditorNode>,
): FieldCollection {
  const queue = [edge];
  const seen = new Set<string>();
  const values = new Set<string>();
  const evidence: ToolingEvidence[] = [];
  let certain = true;
  let limited = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (seen.has(current.nodeId)) {
      if (current.cycle) {
        evidence.push(limitEvidence(current.path));
        limited = true;
        certain = false;
      }
      continue;
    }
    if (seen.size >= MAX_GRAPH_ITEMS) {
      evidence.push(limitEvidence(current.path));
      limited = true;
      certain = false;
      break;
    }
    seen.add(current.nodeId);
    const inspected = inspectRecordKey(current, nodeIndex.get(current.nodeId));
    for (const value of inspected.values) values.add(value);
    queue.push(...inspected.next);
    evidence.push(...inspected.evidence);
    certain &&= inspected.certain;
    if (values.size > MAX_GRAPH_ITEMS) {
      evidence.push(limitEvidence(current.path));
      limited = true;
      certain = false;
      break;
    }
  }
  return {
    entries: [...values]
      .sort(compareText)
      .slice(0, MAX_GRAPH_ITEMS)
      .map((name) => ({ name, presence: "unknown" as const })),
    evidence,
    certain,
    limited,
  };
}

function inspectRecordKey(edge: EditorEdge, node: EditorNode | undefined) {
  if (!node) return uncertain(edge.path, "unresolved-reference");
  if (node.availability !== "available") return uncertainNode(node);
  if (node.kind === "literal") {
    return result(typeof node.value === "string" ? [node.value] : [], [], [], true);
  }
  if (node.kind === "enum") {
    const values = node.values.filter((value): value is string => typeof value === "string");
    return result(values, [], [], values.length === node.values.length);
  }
  if (node.kind === "reference") {
    if (node.status === "resolved" && node.target) return result([], [node.target], [], true);
    return uncertain(node.path, "unresolved-reference");
  }
  if (node.kind === "union") return result([], node.variants, [], true);
  if (node.kind === "wrapper") {
    return structuralWrapper(node.wrapper)
      ? result([], [node.inner], [], true)
      : uncertainNode(node);
  }
  if (node.kind === "never") return result([], [], [], true);
  return uncertainNode(node);
}

function uncertainNode(node: EditorNode) {
  const evidence = node.evidence.map(({ code, path }) => ({ code, path }) as ToolingEvidence);
  if (evidence.length === 0) evidence.push({ code: "unsupported-shape", path: node.path });
  return result([], [], evidence, false);
}

function uncertain(path: EditorEdge["path"], code: ToolingEvidence["code"]) {
  return result([], [], [{ code, path }], false);
}

function result(
  values: readonly string[],
  next: readonly EditorEdge[],
  evidence: readonly ToolingEvidence[],
  certain: boolean,
) {
  return { values, next, evidence, certain };
}

function structuralWrapper(wrapper: string): boolean {
  return ["readonly", "brand", "default", "catch"].includes(wrapper.toLowerCase());
}

function presenceOf(input: { required: boolean; presence?: CandidatePresence }): CandidatePresence {
  return input.presence ?? (input.required ? "required" : "optional");
}

function limitEvidence(path: EditorEdge["path"]): ToolingEvidence {
  return { code: "query-limit", path };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

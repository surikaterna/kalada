import type { EditorEdge, EditorNode, ProvenanceEntry } from "@kalada/host";
import { parseKaladaV1Expression } from "@kalada/syntax";
import type {
  CandidatePresence,
  CandidateSupport,
  ShapeSummary,
  ToolingEvidence,
} from "./contracts.js";
import { freezeData } from "./freeze.js";
import { fieldEntries, MAX_GRAPH_ITEMS } from "./graph-fields.js";

export interface TerminalBranch {
  readonly branch: string;
  readonly node?: EditorNode;
  readonly presence: CandidatePresence;
  readonly certain: boolean;
  readonly evidence: readonly ToolingEvidence[];
}

export interface GraphCandidate {
  readonly label: string;
  readonly support: CandidateSupport;
  readonly presence: CandidatePresence;
  readonly branches: readonly string[];
  readonly evidence: readonly ToolingEvidence[];
}

interface MutableCandidate {
  readonly label: string;
  readonly branches: Set<string>;
  readonly presences: CandidatePresence[];
  readonly evidence: ToolingEvidence[];
  certain: boolean;
}

interface SummaryTarget {
  readonly node: EditorNode;
  readonly branch: string;
  readonly presence: CandidatePresence;
}

interface Collection<T> {
  readonly values: readonly T[];
  readonly evidence: readonly ToolingEvidence[];
  readonly incomplete: boolean;
}

export function finalizeGraphQuery(
  branches: readonly TerminalBranch[],
  nodeIndex: ReadonlyMap<string, EditorNode>,
  provenance: readonly ProvenanceEntry[],
  baseEvidence: readonly ToolingEvidence[],
  incomplete: boolean,
) {
  const candidates = collectCandidates(branches, nodeIndex, baseEvidence);
  const summaries = collectSummaries(branches, provenance, nodeIndex);
  const evidence = deduplicateEvidence([
    ...baseEvidence,
    ...branches.flatMap(sourcePathEvidence),
    ...candidates.evidence,
    ...summaries.evidence,
  ]);
  return freezeData({
    candidates: candidates.values,
    summaries: summaries.values,
    evidence,
    incomplete: incomplete || candidates.incomplete || summaries.incomplete,
    cancelled: false,
  });
}

function collectCandidates(
  branches: readonly TerminalBranch[],
  nodeIndex: ReadonlyMap<string, EditorNode>,
  baseEvidence: readonly ToolingEvidence[],
): Collection<GraphCandidate> {
  const viable = branches.filter(({ node }) => node?.kind !== "never");
  const found = new Map<string, MutableCandidate>();
  const evidence: ToolingEvidence[] = [];
  let incomplete = false;
  for (const branch of viable) {
    const fields = fieldEntries(branch.node, nodeIndex);
    evidence.push(...fields.evidence);
    incomplete ||= fields.limited || !fields.certain;
    for (const entry of fields.entries) {
      if (!sourceAddressable(entry.name)) continue;
      const existing = found.get(entry.name);
      if (!existing && found.size >= MAX_GRAPH_ITEMS) {
        evidence.push(limitEvidence(branch.node?.path ?? []));
        incomplete = true;
        continue;
      }
      const candidate = existing ?? mutableCandidate(entry.name);
      candidate.branches.add(branch.branch);
      candidate.presences.push(entry.presence);
      candidate.certain &&= branch.certain && fields.certain;
      candidate.evidence.push(...branch.evidence, ...fields.evidence);
      found.set(entry.name, candidate);
    }
  }
  const values = [...found.values()]
    .map((candidate) => finishCandidate(candidate, viable.length, baseEvidence))
    .sort(compareCandidate);
  return { values, evidence, incomplete };
}

function collectSummaries(
  branches: readonly TerminalBranch[],
  provenance: readonly ProvenanceEntry[],
  nodeIndex: ReadonlyMap<string, EditorNode>,
): Collection<ShapeSummary> {
  const summaries: ShapeSummary[] = [];
  const evidence: ToolingEvidence[] = [];
  let fields = 0;
  let incomplete = false;
  for (const branch of branches) {
    if (!branch.node || branch.node.kind === "never") continue;
    const targets = summaryTargets(branch, nodeIndex);
    evidence.push(...targets.evidence);
    incomplete ||= targets.incomplete;
    for (const target of targets.values) {
      if (summaries.length >= MAX_GRAPH_ITEMS) {
        evidence.push(limitEvidence(target.node.path));
        incomplete = true;
        break;
      }
      const collected = fieldEntries(target.node, nodeIndex);
      evidence.push(...collected.evidence);
      incomplete ||= collected.limited || !collected.certain;
      const available = Math.max(0, MAX_GRAPH_ITEMS - fields);
      const entries = collected.entries.slice(0, available);
      if (entries.length < collected.entries.length) {
        evidence.push(limitEvidence(target.node.path));
        incomplete = true;
      }
      fields += entries.length;
      summaries.push(shapeSummary(target, entries, provenance));
    }
  }
  return { values: summaries, evidence, incomplete };
}

function summaryTargets(
  branch: TerminalBranch,
  nodeIndex: ReadonlyMap<string, EditorNode>,
): Collection<SummaryTarget> {
  if (!branch.node) return { values: [], evidence: [], incomplete: false };
  const output: SummaryTarget[] = [];
  const queue: SummaryTarget[] = [
    { node: branch.node, branch: branch.branch, presence: branch.presence },
  ];
  const seen = new Set<string>();
  while (queue.length > 0 && output.length < MAX_GRAPH_ITEMS) {
    const target = queue.shift();
    if (!target || seen.has(target.node.id)) continue;
    seen.add(target.node.id);
    output.push(target);
    queue.push(...summaryChildren(target, nodeIndex));
  }
  const next = queue[0];
  return {
    values: output,
    evidence: next ? [limitEvidence(next.node.path)] : [],
    incomplete: next !== undefined,
  };
}

function summaryChildren(
  target: SummaryTarget,
  nodeIndex: ReadonlyMap<string, EditorNode>,
): SummaryTarget[] {
  return summaryEdges(target.node).flatMap(({ edge, label }, index) => {
    const node = nodeIndex.get(edge.nodeId);
    return node
      ? [{ node, branch: `${target.branch}/${label}:${index}`, presence: "unknown" as const }]
      : [];
  });
}

function summaryEdges(node: EditorNode): readonly { edge: EditorEdge; label: string }[] {
  if (node.kind === "array") return [{ edge: node.element, label: "element" }];
  if (node.kind === "tuple") {
    const items = node.items.map((edge) => ({ edge, label: "item" }));
    return node.rest ? [...items, { edge: node.rest, label: "rest" }] : items;
  }
  if (node.kind === "reference" && node.target) return [{ edge: node.target, label: "reference" }];
  if (node.kind === "union") return node.variants.map((edge) => ({ edge, label: "variant" }));
  if (node.kind === "intersection")
    return node.operands.map((edge) => ({ edge, label: "operand" }));
  if (node.kind === "wrapper") return [{ edge: node.inner, label: "wrapper" }];
  return [];
}

function shapeSummary(
  target: SummaryTarget,
  entries: readonly { name: string; presence: CandidatePresence }[],
  provenance: readonly ProvenanceEntry[],
): ShapeSummary {
  const summary: ShapeSummary = {
    kind: target.node.kind,
    path: target.node.path,
    presence: target.presence,
    branches: [target.branch],
    fields: entries.map(({ name, presence }) => ({
      name,
      presence,
      accessible: sourceAddressable(name),
    })),
    provenance: sanitizeProvenance(provenance),
  };
  if (target.node.kind === "scalar") Object.assign(summary, { scalar: target.node.name });
  return summary;
}

function finishCandidate(
  candidate: MutableCandidate,
  viable: number,
  baseEvidence: readonly ToolingEvidence[],
): GraphCandidate {
  const branches = [...candidate.branches].sort(compareText);
  const support = candidate.certain && branches.length === viable ? "common" : "conditional";
  const uncertainty = support === "conditional" ? baseEvidence : [];
  return {
    label: candidate.label,
    support,
    presence: combinePresence(candidate.presences),
    branches,
    evidence: deduplicateEvidence([...candidate.evidence, ...uncertainty]),
  };
}

function sourcePathEvidence(branch: TerminalBranch): ToolingEvidence[] {
  const node = branch.node;
  if (!node) return [];
  if (node.kind === "array" || node.kind === "tuple") {
    return [{ code: "unsupported-source-path", path: node.path }];
  }
  if (node.kind !== "object") return [];
  return node.properties
    .filter(({ name }) => !sourceAddressable(name))
    .map(({ name }) => ({ code: "unsupported-source-path", path: [...node.path, name] }));
}

function mutableCandidate(label: string): MutableCandidate {
  return { label, branches: new Set(), presences: [], evidence: [], certain: true };
}

function combinePresence(values: readonly CandidatePresence[]): CandidatePresence {
  if (values.includes("unknown")) return "unknown";
  return values.every((value) => value === "required") ? "required" : "optional";
}

function sourceAddressable(name: string): boolean {
  const parsed = parseKaladaV1Expression(`root.${name}`);
  const expression = parsed.document.expression;
  return (
    parsed.diagnostics.length === 0 &&
    expression.kind === "field-access" &&
    expression.field === name
  );
}

function sanitizeProvenance(entries: readonly ProvenanceEntry[]) {
  const found = new Map<string, { providerId: string; providerVersion?: string }>();
  for (const { providerId, providerVersion } of entries) {
    found.set(
      `${providerId}:${providerVersion ?? ""}`,
      providerVersion ? { providerId, providerVersion } : { providerId },
    );
  }
  return [...found.values()];
}

function deduplicateEvidence(entries: readonly ToolingEvidence[]): ToolingEvidence[] {
  const found = new Map<string, ToolingEvidence>();
  for (const entry of entries) found.set(`${entry.code}:${JSON.stringify(entry.path)}`, entry);
  return [...found.values()].sort((left, right) =>
    compareText(evidenceKey(left), evidenceKey(right)),
  );
}

function evidenceKey(entry: ToolingEvidence): string {
  return `${entry.code}:${JSON.stringify(entry.path)}`;
}

function limitEvidence(path: EditorEdge["path"]): ToolingEvidence {
  return { code: "query-limit", path };
}

function compareCandidate(left: GraphCandidate, right: GraphCandidate): number {
  if (left.support !== right.support) return left.support === "common" ? -1 : 1;
  return compareText(left.label, right.label);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

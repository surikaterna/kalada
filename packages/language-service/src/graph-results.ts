import type { EditorEdge, EditorNode, ProvenanceEntry } from "@kalada/host";
import { parseKaladaV1Expression } from "@kalada/syntax";
import type {
  CandidatePresence,
  CandidateSupport,
  ShapeSummary,
  ToolingEvidence,
} from "./contracts.js";
import { freezeData } from "./freeze.js";

const MAX_ITEMS = 256;
const MAX_FIELDS = 256;

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

export function finalizeGraphQuery(
  branches: readonly TerminalBranch[],
  nodeIndex: ReadonlyMap<string, EditorNode>,
  provenance: readonly ProvenanceEntry[],
  baseEvidence: readonly ToolingEvidence[],
  incomplete: boolean,
) {
  const candidates = collectCandidates(branches, nodeIndex);
  return freezeData({
    candidates,
    summaries: collectSummaries(branches, provenance, nodeIndex),
    evidence: deduplicateEvidence([...baseEvidence, ...branches.flatMap(sourcePathEvidence)]),
    incomplete: incomplete || candidates.length >= MAX_ITEMS,
    cancelled: false,
  });
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

function collectCandidates(
  branches: readonly TerminalBranch[],
  nodeIndex: ReadonlyMap<string, EditorNode>,
): readonly GraphCandidate[] {
  const viable = branches.filter(({ node }) => node?.kind !== "never");
  const found = new Map<string, MutableCandidate>();
  for (const branch of viable) collectBranchCandidates(branch, found, nodeIndex);
  return [...found.values()]
    .map((candidate) => finishCandidate(candidate, viable.length))
    .sort(compareCandidate)
    .slice(0, MAX_ITEMS);
}

function collectBranchCandidates(
  branch: TerminalBranch,
  found: Map<string, MutableCandidate>,
  nodeIndex: ReadonlyMap<string, EditorNode>,
): void {
  for (const entry of fieldEntries(branch.node, nodeIndex)) {
    if (!sourceAddressable(entry.name)) continue;
    const candidate = found.get(entry.name) ?? mutableCandidate(entry.name);
    candidate.branches.add(branch.branch);
    candidate.presences.push(entry.presence);
    candidate.certain &&= branch.certain;
    candidate.evidence.push(...branch.evidence);
    found.set(entry.name, candidate);
  }
}

function fieldEntries(
  node: EditorNode | undefined,
  nodeIndex: ReadonlyMap<string, EditorNode>,
): readonly { name: string; presence: CandidatePresence }[] {
  if (node?.kind === "object") {
    return node.properties.map((property) => ({
      name: property.name,
      presence: presenceOf(property),
    }));
  }
  if (node?.kind !== "record") return [];
  return finiteStringKeys(node.key, nodeIndex).map((name) => ({ name, presence: "unknown" }));
}

function finiteStringKeys(edge: EditorEdge, nodeIndex: ReadonlyMap<string, EditorNode>): string[] {
  const output = new Set<string>();
  const queue = [edge.nodeId];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < MAX_FIELDS) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = nodeIndex.get(id);
    collectFiniteValues(node, output);
    queue.push(...finiteNext(node));
  }
  return [...output].sort(compareText);
}

function collectFiniteValues(node: EditorNode | undefined, output: Set<string>): void {
  if (node?.kind === "literal" && typeof node.value === "string") output.add(node.value);
  if (node?.kind !== "enum") return;
  for (const value of node.values) if (typeof value === "string") output.add(value);
}

function finiteNext(node: EditorNode | undefined): string[] {
  if (node?.kind === "reference" && node.target) return [node.target.nodeId];
  if (node?.kind === "union") return node.variants.map(({ nodeId }) => nodeId);
  if (node?.kind === "wrapper") return [node.inner.nodeId];
  return [];
}

function collectSummaries(
  branches: readonly TerminalBranch[],
  provenance: readonly ProvenanceEntry[],
  nodeIndex: ReadonlyMap<string, EditorNode>,
): readonly ShapeSummary[] {
  const summaries: ShapeSummary[] = [];
  let fields = 0;
  for (const branch of branches) {
    if (!branch.node || branch.node.kind === "never") continue;
    const entries = fieldEntries(branch.node, nodeIndex).slice(0, Math.max(0, MAX_FIELDS - fields));
    fields += entries.length;
    const summary: ShapeSummary = {
      kind: branch.node.kind,
      path: branch.node.path,
      presence: branch.presence,
      branches: [branch.branch],
      fields: entries.map(({ name, presence }) => ({
        name,
        presence,
        accessible: sourceAddressable(name),
      })),
      provenance: sanitizeProvenance(provenance),
    };
    if (branch.node.kind === "scalar") Object.assign(summary, { scalar: branch.node.name });
    summaries.push(summary);
  }
  return summaries;
}

function finishCandidate(candidate: MutableCandidate, viable: number): GraphCandidate {
  const branches = [...candidate.branches].sort(compareText);
  return {
    label: candidate.label,
    support: candidate.certain && branches.length === viable ? "common" : "conditional",
    presence: combinePresence(candidate.presences),
    branches,
    evidence: deduplicateEvidence(candidate.evidence),
  };
}

function mutableCandidate(label: string): MutableCandidate {
  return { label, branches: new Set(), presences: [], evidence: [], certain: true };
}

function presenceOf(input: { required: boolean; presence?: CandidatePresence }): CandidatePresence {
  return input.presence ?? (input.required ? "required" : "optional");
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

function compareCandidate(left: GraphCandidate, right: GraphCandidate): number {
  if (left.support !== right.support) return left.support === "common" ? -1 : 1;
  return compareText(left.label, right.label);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

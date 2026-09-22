import type { NormalizedEnvironment } from "@kalada/host";
import type {
  CancellationToken,
  CandidatePresence,
  ShapeSummary,
  ToolingEvidence,
} from "./contracts.js";
import type { ShapePath } from "./cursor-context.js";
import { queryEditorGraph } from "./graph-query.js";
import type { GraphCandidate } from "./graph-results.js";

export interface CombinedGraph {
  readonly candidates: readonly GraphCandidate[];
  readonly summaries: readonly ShapeSummary[];
  readonly evidence: readonly ToolingEvidence[];
  readonly incomplete: boolean;
  readonly cancelled: boolean;
}

export function queryShapePaths(
  paths: readonly ShapePath[],
  environment: NormalizedEnvironment | undefined,
  cancellation?: CancellationToken,
): CombinedGraph {
  if (!environment || paths.length === 0) return emptyCombinedGraph(paths.length > 0);
  const queries = paths.map((path) => {
    const binding = environment.bindings.find(({ name }) => name === path.bindingName);
    return binding
      ? queryEditorGraph(environment, binding, path.segments, cancellation)
      : emptyCombinedGraph(true);
  });
  if (queries.some(({ cancelled }) => cancelled)) {
    return { ...emptyCombinedGraph(true), cancelled: true };
  }
  return combineGraphs(queries);
}

export function emptyCombinedGraph(incomplete = false): CombinedGraph {
  return { candidates: [], summaries: [], evidence: [], incomplete, cancelled: false };
}

export function deduplicateEvidence(entries: readonly ToolingEvidence[]): ToolingEvidence[] {
  const found = new Map<string, ToolingEvidence>();
  for (const entry of entries) found.set(`${entry.code}:${JSON.stringify(entry.path)}`, entry);
  return [...found.values()].sort((left, right) => compareText(left.code, right.code));
}

function combineGraphs(graphs: readonly CombinedGraph[]): CombinedGraph {
  const candidates = new Map<string, { values: GraphCandidate[]; paths: Set<number> }>();
  graphs.forEach((graph, index) => {
    collectGraphCandidates(candidates, graph, index);
  });
  const merged = [...candidates.values()].map(({ values, paths }) =>
    mergeCandidate(values, paths.size === graphs.length),
  );
  return {
    candidates: merged.sort(compareGraphCandidates),
    summaries: graphs.flatMap(({ summaries }, index) => prefixSummaries(summaries, index)),
    evidence: deduplicateEvidence(graphs.flatMap(({ evidence }) => evidence)),
    incomplete: graphs.some(({ incomplete }) => incomplete),
    cancelled: false,
  };
}

function collectGraphCandidates(
  candidates: Map<string, { values: GraphCandidate[]; paths: Set<number> }>,
  graph: CombinedGraph,
  index: number,
): void {
  for (const candidate of graph.candidates) {
    const entry = candidates.get(candidate.label) ?? { values: [], paths: new Set() };
    entry.values.push(prefixCandidate(candidate, index));
    entry.paths.add(index);
    candidates.set(candidate.label, entry);
  }
}

function mergeCandidate(values: readonly GraphCandidate[], allPaths: boolean): GraphCandidate {
  const first = values[0];
  return {
    label: first?.label ?? "",
    support:
      allPaths && values.every(({ support }) => support === "common") ? "common" : "conditional",
    presence: combinePresence(values.map(({ presence }) => presence)),
    branches: values.flatMap(({ branches }) => branches).sort(compareText),
    evidence: deduplicateEvidence(values.flatMap(({ evidence }) => evidence)),
  };
}

function prefixCandidate(candidate: GraphCandidate, index: number): GraphCandidate {
  return { ...candidate, branches: candidate.branches.map((branch) => `${index}:${branch}`) };
}

function prefixSummaries(summaries: readonly ShapeSummary[], index: number): ShapeSummary[] {
  return summaries.map((summary) => ({
    ...summary,
    branches: summary.branches.map((branch) => `${index}:${branch}`),
  }));
}

function combinePresence(values: readonly CandidatePresence[]): CandidatePresence {
  if (values.includes("unknown")) return "unknown";
  return values.every((value) => value === "required") ? "required" : "optional";
}

function compareGraphCandidates(left: GraphCandidate, right: GraphCandidate): number {
  if (left.support !== right.support) return left.support === "common" ? -1 : 1;
  return compareText(left.label, right.label);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

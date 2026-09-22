import type {
  EditorEdge,
  EditorNode,
  HostPath,
  NormalizedBinding,
  NormalizedEnvironment,
} from "@kalada/host";
import type {
  CancellationToken,
  CandidatePresence,
  ShapeSummary,
  ToolingEvidence,
} from "./contracts.js";
import { freezeData } from "./freeze.js";
import type { GraphCandidate } from "./graph-results.js";
import { finalizeGraphQuery, type TerminalBranch } from "./graph-results.js";

const MAX_DEPTH = 32;
const MAX_VISITS = 4096;
interface QueryState {
  readonly nodeId: string;
  readonly path: HostPath;
  readonly segment: number;
  readonly branch: string;
  readonly presence: CandidatePresence;
  readonly certain: boolean;
  readonly depth: number;
  readonly ancestors: ReadonlySet<string>;
}

export interface GraphQueryResult {
  readonly candidates: readonly GraphCandidate[];
  readonly summaries: readonly ShapeSummary[];
  readonly evidence: readonly ToolingEvidence[];
  readonly incomplete: boolean;
  readonly cancelled: boolean;
}

export function queryEditorGraph(
  environment: NormalizedEnvironment,
  binding: NormalizedBinding,
  segments: readonly string[],
  cancellation?: CancellationToken,
): GraphQueryResult {
  const nodeIndex = new Map(environment.editorGraph.nodes.map((node) => [node.id, node]));
  const root = environment.editorGraph.roots.find(({ bindingId }) => bindingId === binding.id);
  if (!root) return emptyUnknown(binding.path);
  const context = { binding, segments, nodeIndex, cancellation };
  const resolved = resolveBranches(root, context);
  if (resolved.cancelled) return cancelledResult();
  return finalizeGraphQuery(
    resolved.branches,
    nodeIndex,
    binding.provenance,
    [
      ...environment.editorGraph.evidence.map(
        ({ code, path }) => ({ code, path }) as ToolingEvidence,
      ),
      ...resolved.evidence,
      ...resolved.branches.flatMap((branch) => branch.evidence),
    ],
    resolved.incomplete,
  );
}

interface ResolveContext {
  readonly binding: NormalizedBinding;
  readonly segments: readonly string[];
  readonly nodeIndex: ReadonlyMap<string, EditorNode>;
  readonly cancellation?: CancellationToken;
}

function resolveBranches(root: EditorEdge, context: ResolveContext) {
  const initial = makeState(
    root,
    0,
    `binding:${context.binding.id}`,
    "unknown",
    true,
    0,
    new Set(),
  );
  const queue: QueryState[] = [initial];
  const branches: TerminalBranch[] = [];
  const evidence: ToolingEvidence[] = [];
  let visits = 0;
  let incomplete = false;
  while (queue.length > 0) {
    if (visits % 64 === 0 && context.cancellation?.isCancellationRequested()) {
      return { branches: [], evidence: [], incomplete: true, cancelled: true };
    }
    const state = queue.shift();
    if (!state) continue;
    visits += 1;
    if (visits > MAX_VISITS || state.depth > MAX_DEPTH) {
      branches.push(unknownBranch(state, "query-limit", []));
      incomplete = true;
      continue;
    }
    const node = context.nodeIndex.get(state.nodeId);
    if (!node) {
      branches.push(unknownBranch(state, "unresolved-reference", []));
      incomplete = true;
      continue;
    }
    const inspected = inspectNode(state, node, context);
    queue.push(...inspected.next);
    branches.push(...inspected.terminals);
    evidence.push(...inspected.evidence);
    incomplete ||= inspected.incomplete;
  }
  return { branches, evidence, incomplete, cancelled: false };
}

function inspectNode(state: QueryState, node: EditorNode, context: ResolveContext) {
  const evidence = nodeEvidence(node);
  const certain = state.certain && node.availability === "available";
  const current = { ...state, certain };
  if (node.availability === "unavailable") {
    return inspected([], [unknownBranch(current, "unsupported-shape", evidence)], evidence, true);
  }
  const expanded = expandNode(current, node, context);
  return inspected(expanded.next, expanded.terminals, evidence, !certain || evidence.length > 0);
}

function expandNode(state: QueryState, node: EditorNode, context: ResolveContext) {
  if (node.kind === "reference") return expandReference(state, node.target, context, node.status);
  if (node.kind === "union") return expandEdges(state, node.variants, context, "variant");
  if (node.kind === "intersection") return expandEdges(state, node.operands, context, "operand");
  if (node.kind === "wrapper") return expandWrapper(state, node.inner, node.wrapper, context);
  if (state.segment >= context.segments.length)
    return { next: [], terminals: [terminal(state, node)] };
  const name = context.segments[state.segment];
  if (node.kind === "object") {
    const property = node.properties.find((candidate) => candidate.name === name);
    return property
      ? advanceEdge(state, property, context, `property:${property.name}`, presenceOf(property))
      : { next: [], terminals: [unknownBranch(state, "unsupported-source-path", [])] };
  }
  if (node.kind === "record")
    return advanceEdge(state, node.value, context, "record-value", "unknown");
  return { next: [], terminals: [unknownBranch(state, "unsupported-source-path", [])] };
}

function expandReference(
  state: QueryState,
  target: EditorEdge | undefined,
  context: ResolveContext,
  status: "resolved" | "unresolved",
) {
  if (!target || status === "unresolved") {
    return { next: [], terminals: [unknownBranch(state, "unresolved-reference", [])] };
  }
  return followEdges(state, [target], context, "reference", false);
}

function expandEdges(
  state: QueryState,
  edges: readonly EditorEdge[],
  context: ResolveContext,
  label: string,
) {
  if (edges.length === 0)
    return { next: [], terminals: [unknownBranch(state, "unsupported-shape", [])] };
  return followEdges(state, edges, context, label, false);
}

function expandWrapper(
  state: QueryState,
  inner: EditorEdge,
  wrapper: string,
  context: ResolveContext,
) {
  const normalized = wrapper.toLowerCase();
  const structural = ["readonly", "brand", "default", "catch"].includes(normalized);
  const nullable = ["optional", "nullable"].includes(normalized);
  const followed = followEdges(
    { ...state, certain: state.certain && structural },
    [inner],
    context,
    "wrapper",
    false,
  );
  if (structural) return followed;
  const unknown = unknownBranch(state, nullable ? "unsupported-source-path" : "opaque-wrapper", []);
  return { next: followed.next, terminals: [...followed.terminals, unknown] };
}

function advanceEdge(
  state: QueryState,
  edge: EditorEdge,
  context: ResolveContext,
  label: string,
  presence: CandidatePresence,
) {
  return followEdges(
    { ...state, segment: state.segment + 1, presence },
    [edge],
    context,
    label,
    true,
  );
}

function followEdges(
  state: QueryState,
  edges: readonly EditorEdge[],
  _context: ResolveContext,
  label: string,
  progressed: boolean,
) {
  const next: QueryState[] = [];
  const terminals: TerminalBranch[] = [];
  edges.forEach((edge, index) => {
    const key = `${edge.nodeId}:${state.segment}`;
    if (state.ancestors.has(key) && !progressed) {
      terminals.push(unknownBranch(state, "query-limit", []));
      return;
    }
    const branch = `${state.branch}/${label}:${index}`;
    next.push(
      makeState(
        edge,
        state.segment,
        branch,
        state.presence,
        state.certain,
        state.depth + 1,
        state.ancestors,
      ),
    );
  });
  return { next, terminals };
}

function makeState(
  edge: EditorEdge,
  segment: number,
  branch: string,
  presence: CandidatePresence,
  certain: boolean,
  depth: number,
  ancestors: ReadonlySet<string>,
): QueryState {
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(`${edge.nodeId}:${segment}`);
  return {
    nodeId: edge.nodeId,
    path: edge.path,
    segment,
    branch,
    presence,
    certain,
    depth,
    ancestors: nextAncestors,
  };
}

function presenceOf(input: { required: boolean; presence?: CandidatePresence }): CandidatePresence {
  return input.presence ?? (input.required ? "required" : "optional");
}

function terminal(state: QueryState, node: EditorNode): TerminalBranch {
  return {
    branch: state.branch,
    node,
    presence: state.presence,
    certain: state.certain,
    evidence: [],
  };
}

function unknownBranch(
  state: QueryState,
  code: ToolingEvidence["code"],
  evidence: readonly ToolingEvidence[],
): TerminalBranch {
  return {
    branch: state.branch,
    node: undefined,
    presence: state.presence,
    certain: false,
    evidence: [...evidence, { code, path: state.path }],
  };
}

function nodeEvidence(node: EditorNode): ToolingEvidence[] {
  const evidence = node.evidence.map(({ code, path }) => ({ code, path }) as ToolingEvidence);
  if (node.kind === "unknown") evidence.push({ code: "unsupported-shape", path: node.path });
  if (node.kind === "opaque") evidence.push({ code: "opaque-wrapper", path: node.path });
  if (node.kind === "array" || node.kind === "tuple") {
    evidence.push({ code: "unsupported-source-path", path: node.path });
  }
  return evidence;
}

function inspected(
  next: readonly QueryState[],
  terminals: readonly TerminalBranch[],
  evidence: readonly ToolingEvidence[],
  incomplete: boolean,
) {
  return { next, terminals, evidence, incomplete };
}

function emptyUnknown(path: HostPath): GraphQueryResult {
  return freezeData({
    candidates: [],
    summaries: [],
    evidence: [{ code: "unresolved-reference", path }],
    incomplete: true,
    cancelled: false,
  });
}

function cancelledResult(): GraphQueryResult {
  return freezeData({
    candidates: [],
    summaries: [],
    evidence: [],
    incomplete: true,
    cancelled: true,
  });
}

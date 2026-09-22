import type { NormalizedEnvironment, Utf16Position } from "@kalada/host";
import {
  type KaladaCstNode,
  type KaladaLowerOptions,
  type KaladaSemanticNodeInfo,
  type KaladaSemanticSupport,
  type KaladaSyntaxDiagnostic,
  parseKaladaV1Expression,
  queryKaladaV1Semantics,
} from "@kalada/syntax";
import type {
  CancellationToken,
  CandidatePresence,
  CompletionItem,
  DocumentSnapshot,
  EnvironmentSnapshot,
  HoverInfo,
  LanguageServiceDiagnostic,
  ToolingCheckpoint,
  ToolingEvidence,
} from "./contracts.js";
import { type CompletionContext, completionContext, hoverContext } from "./cursor-context.js";
import { freezeData } from "./freeze.js";
import type { GraphCandidate } from "./graph-results.js";
import {
  type CombinedGraph,
  deduplicateEvidence,
  emptyCombinedGraph,
  queryShapePaths,
} from "./tooling-graph.js";

interface CompletionPayload {
  readonly kind: "completion";
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly items: readonly CompletionItem[];
  readonly incomplete: boolean;
  readonly evidence: readonly ToolingEvidence[];
}

interface HoverPayload {
  readonly kind: "hover";
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly hover: HoverInfo | null;
  readonly incomplete: boolean;
  readonly evidence: readonly ToolingEvidence[];
}

type ToolingRun<T> =
  | Readonly<{ cancelled: true; checkpoint: ToolingCheckpoint }>
  | Readonly<{ cancelled: false; value: T }>;

interface PreparedTooling {
  readonly offset: number;
  readonly environment?: NormalizedEnvironment;
  readonly parsed: ReturnType<typeof parseKaladaV1Expression>;
  readonly semantics: ReturnType<typeof queryKaladaV1Semantics>;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
}

export function runCompletion(
  document: DocumentSnapshot,
  environment: EnvironmentSnapshot,
  position: Utf16Position,
  cancellation?: CancellationToken,
): ToolingRun<CompletionPayload> {
  const prepared = prepareTooling(document, environment, position, cancellation);
  if (prepared.cancelled) return prepared;
  const contextCancelled = cancelledAt("context", cancellation);
  if (contextCancelled) return contextCancelled;
  const context = completionContext(prepared.value.parsed, prepared.value.offset);
  const beforeQuery = cancelledAt("before-query", cancellation);
  if (beforeQuery) return beforeQuery;
  const queried = completionItems(context, prepared.value, document, cancellation);
  if (queried.cancelled) return { cancelled: true, checkpoint: "after-query" };
  const afterQuery = cancelledAt("after-query", cancellation);
  if (afterQuery) return afterQuery;
  const complete = cancelledAt("complete", cancellation);
  if (complete) return complete;
  return {
    cancelled: false,
    value: freezeData({
      kind: "completion",
      diagnostics: prepared.value.diagnostics,
      items: queried.items,
      incomplete: prepared.value.semantics.incomplete || queried.incomplete,
      evidence: queried.evidence,
    }),
  };
}

export function runHover(
  document: DocumentSnapshot,
  environment: EnvironmentSnapshot,
  position: Utf16Position,
  cancellation?: CancellationToken,
): ToolingRun<HoverPayload> {
  const prepared = prepareTooling(document, environment, position, cancellation);
  if (prepared.cancelled) return prepared;
  const contextCancelled = cancelledAt("context", cancellation);
  if (contextCancelled) return contextCancelled;
  const context = hoverContext(prepared.value.parsed, prepared.value.offset);
  const beforeQuery = cancelledAt("before-query", cancellation);
  if (beforeQuery) return beforeQuery;
  const graph = context
    ? queryShapePaths(context.paths, prepared.value.environment, cancellation)
    : emptyCombinedGraph();
  if (graph.cancelled) return { cancelled: true, checkpoint: "after-query" };
  const afterQuery = cancelledAt("after-query", cancellation);
  if (afterQuery) return afterQuery;
  const hover = context ? buildHover(context, graph, prepared.value, document) : null;
  const complete = cancelledAt("complete", cancellation);
  if (complete) return complete;
  return {
    cancelled: false,
    value: freezeData({
      kind: "hover",
      diagnostics: prepared.value.diagnostics,
      hover,
      incomplete: prepared.value.semantics.incomplete || graph.incomplete,
      evidence: graph.evidence,
    }),
  };
}

function prepareTooling(
  document: DocumentSnapshot,
  environment: EnvironmentSnapshot,
  position: Utf16Position,
  cancellation?: CancellationToken,
): ToolingRun<PreparedTooling> {
  const offset = document.lineIndex.offsetAt(position);
  for (const checkpoint of ["captured", "environment", "before-parse"] as const) {
    const cancelled = cancelledAt(checkpoint, cancellation);
    if (cancelled) return cancelled;
  }
  const parsed = parseKaladaV1Expression(document.text);
  const afterParse = cancelledAt("after-parse", cancellation);
  if (afterParse) return afterParse;
  const normalized = environment.description.ok ? environment.description.environment : undefined;
  const semantics = queryKaladaV1Semantics(parsed, lowerOptions(normalized));
  const diagnostics = environment.description.ok
    ? semantics.diagnostics.map((problem) => syntaxDiagnostic(problem, document))
    : environment.description.diagnostics;
  return {
    cancelled: false,
    value: { offset, environment: normalized, parsed, semantics, diagnostics },
  };
}

function completionItems(
  context: CompletionContext,
  prepared: PreparedTooling,
  document: DocumentSnapshot,
  cancellation?: CancellationToken,
) {
  if (context.kind === "binding") return bindingItems(context, prepared.environment, document);
  if (context.kind === "property") {
    const semantic = semanticFor(context.target, prepared.semantics.nodes);
    const support = context.optional ? semantic?.fieldAccess.optional : semantic?.fieldAccess.plain;
    if (support === "unsupported") return emptyItems([{ code: "semantic-unknown", path: [] }]);
    const graph = queryShapePaths(context.paths, prepared.environment, cancellation);
    const items = graph.candidates.map((candidate) =>
      propertyItem(candidate, context, document, support ?? "conditional"),
    );
    const evidence =
      support === "conditional"
        ? deduplicateEvidence([...graph.evidence, { code: "semantic-unknown", path: [] }])
        : graph.evidence;
    return { items, evidence, incomplete: graph.incomplete, cancelled: graph.cancelled };
  }
  if (context.kind === "operator") return operatorItems(context, prepared, document);
  return emptyItems([{ code: "unsupported-source-path", path: [] }]);
}

function bindingItems(
  context: Extract<CompletionContext, { kind: "binding" }>,
  environment: NormalizedEnvironment | undefined,
  document: DocumentSnapshot,
) {
  const items = (environment?.bindings ?? [])
    .filter(({ name }) => sourceBinding(name))
    .map((binding) =>
      completionItem(
        binding.name,
        "binding",
        context.range,
        document,
        "common",
        "required",
        [],
        [],
      ),
    );
  return { items: items.sort(compareItems), evidence: [], incomplete: false, cancelled: false };
}

function propertyItem(
  candidate: GraphCandidate,
  context: Extract<CompletionContext, { kind: "property" }>,
  document: DocumentSnapshot,
  semanticSupport: KaladaSemanticSupport,
): CompletionItem {
  return completionItem(
    candidate.label,
    "property",
    context.range,
    document,
    semanticSupport === "supported" ? candidate.support : "conditional",
    candidate.presence,
    candidate.branches,
    candidate.evidence,
  );
}

function operatorItems(
  context: Extract<CompletionContext, { kind: "operator" }>,
  prepared: PreparedTooling,
  document: DocumentSnapshot,
) {
  const semantic = semanticFor(context.node, prepared.semantics.nodes);
  const operators = semantic?.operators.filter(({ support }) => support !== "unsupported") ?? [];
  const evidence: ToolingEvidence[] = semantic?.known
    ? []
    : [{ code: "semantic-unknown", path: [] }];
  const items = operators.map(({ operator, support }) =>
    completionItem(
      operator,
      "operator",
      context.range,
      document,
      support === "supported" ? "common" : "conditional",
      "unknown",
      [],
      evidence,
    ),
  );
  return {
    items: items.sort(compareItems),
    evidence,
    incomplete: !semantic?.known,
    cancelled: false,
  };
}

function buildHover(
  context: NonNullable<ReturnType<typeof hoverContext>>,
  graph: CombinedGraph,
  prepared: PreparedTooling,
  document: DocumentSnapshot,
): HoverInfo {
  const semantic = semanticFor(context.node, prepared.semantics.nodes);
  const target = context.node.kind === "field-access" ? context.node.target : context.node;
  const targetSemantic = semanticFor(target, prepared.semantics.nodes);
  const access = semanticAccess(context.access, targetSemantic);
  const evidence = [...graph.evidence];
  if (!semantic?.known) evidence.push({ code: "semantic-unknown", path: [] });
  return {
    range: offsetRange(context.token.range, document),
    input: graph.summaries,
    output: { type: semantic?.type ?? "dynamic", known: semantic?.known ?? false },
    access,
    evidence: deduplicateEvidence(evidence),
  };
}

function lowerOptions(environment?: NormalizedEnvironment): KaladaLowerOptions<string> | undefined {
  if (!environment) return undefined;
  return {
    references: Object.fromEntries(
      environment.compileProjection.bindings.map(({ id, name, semanticType }) => [
        name,
        { reference: id, type: semanticType },
      ]),
    ),
  };
}

function semanticFor(
  node: KaladaCstNode,
  semantics: readonly KaladaSemanticNodeInfo[],
): KaladaSemanticNodeInfo | undefined {
  return semantics.findLast(
    ({ range }) => range.start === node.range.start && range.end === node.range.end,
  );
}

function semanticAccess(
  access: "plain" | "optional" | "none",
  semantic?: KaladaSemanticNodeInfo,
): KaladaSemanticSupport {
  if (access === "none") return "supported";
  return access === "plain"
    ? (semantic?.fieldAccess.plain ?? "conditional")
    : (semantic?.fieldAccess.optional ?? "conditional");
}

function completionItem(
  label: string,
  kind: CompletionItem["kind"],
  range: Readonly<{ start: number; end: number }>,
  document: DocumentSnapshot,
  support: CompletionItem["support"],
  presence: CandidatePresence,
  branches: readonly string[],
  evidence: readonly ToolingEvidence[],
): CompletionItem {
  return {
    label,
    kind,
    edit: { range: offsetRange(range, document), text: label },
    support,
    presence,
    branches,
    evidence,
  };
}

function offsetRange(range: Readonly<{ start: number; end: number }>, document: DocumentSnapshot) {
  return {
    start: document.lineIndex.positionAt(range.start),
    end: document.lineIndex.positionAt(range.end),
  };
}

function sourceBinding(name: string): boolean {
  const parsed = parseKaladaV1Expression(name);
  return parsed.diagnostics.length === 0 && parsed.document.expression.kind === "reference";
}

function syntaxDiagnostic(
  cause: KaladaSyntaxDiagnostic,
  document: DocumentSnapshot,
): LanguageServiceDiagnostic {
  return {
    code: cause.code,
    phase: cause.phase === "lower" ? "lower" : "parse",
    message: cause.message,
    source: { uri: document.uri, range: offsetRange(cause.range, document) },
    cause,
  };
}

function cancelledAt(checkpoint: ToolingCheckpoint, cancellation?: CancellationToken) {
  return cancellation?.isCancellationRequested()
    ? ({ cancelled: true as const, checkpoint } as const)
    : null;
}

function emptyItems(evidence: readonly ToolingEvidence[]) {
  return { items: [], evidence, incomplete: evidence.length > 0, cancelled: false };
}

function compareItems(left: CompletionItem, right: CompletionItem): number {
  if (left.support !== right.support) return left.support === "common" ? -1 : 1;
  return compareText(left.label, right.label);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

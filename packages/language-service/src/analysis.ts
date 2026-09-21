import {
  type CapabilitySnapshot,
  type CompiledExpression,
  compileExpression,
  type DescribeEnvironmentResult,
  linkExpression,
  type NormalizedEnvironment,
  type ParsedExpression,
  parseExpression,
} from "@kalada/host";
import type {
  AnalysisCheckpoint,
  CancellationToken,
  DocumentSnapshot,
  EnvironmentSnapshot,
  LanguageAnalysis,
  LanguageServiceDiagnostic,
} from "./contracts.js";

type Cancellation = Readonly<{ cancelled: true; checkpoint: AnalysisCheckpoint }>;
type Stage<T> = Cancellation | Readonly<{ cancelled: false; value: T }>;

export type PhaseRun =
  | Cancellation
  | Readonly<{
      cancelled: false;
      diagnostics: readonly LanguageServiceDiagnostic[];
      analysis: LanguageAnalysis;
    }>;

interface PhaseState {
  readonly diagnostics: LanguageServiceDiagnostic[];
  readonly analysis: MutableAnalysis;
}

interface MutableAnalysis extends LanguageAnalysis {
  environment?: NormalizedEnvironment;
  syntax?: NonNullable<LanguageAnalysis["syntax"]>;
  program?: NonNullable<LanguageAnalysis["program"]>;
  sourceMap?: NonNullable<LanguageAnalysis["sourceMap"]>;
}

export function runAnalysisPhases(
  document: DocumentSnapshot,
  environment: EnvironmentSnapshot,
  cancellation?: CancellationToken,
): PhaseRun {
  const captured = cancelledAt("captured", cancellation);
  if (captured) return captured;
  const state = createState(environment.description);
  const inspected = cancelledAt("environment", cancellation);
  if (inspected) return inspected;
  const parsed = parsePhase(state, document, cancellation);
  if (parsed.cancelled) return parsed;
  if (!parsed.value || !environment.description.ok) return finish(state, cancellation);
  const compiled = compilePhase(
    state,
    parsed.value,
    environment.description.environment,
    cancellation,
  );
  if (compiled.cancelled) return compiled;
  if (!compiled.value) return finish(state, cancellation);
  const linked = linkPhase(
    state,
    compiled.value,
    environment.description.environment,
    environment.description.capabilitySnapshot,
    cancellation,
  );
  return linked ?? finish(state, cancellation);
}

function createState(description: DescribeEnvironmentResult): PhaseState {
  const diagnostics = description.ok ? [] : [...description.diagnostics];
  const analysis: MutableAnalysis = {};
  if (description.ok) analysis.environment = description.environment;
  return { diagnostics, analysis };
}

function parsePhase(
  state: PhaseState,
  document: DocumentSnapshot,
  cancellation?: CancellationToken,
): Stage<ParsedExpression | null> {
  const before = cancelledAt("before-parse", cancellation);
  if (before) return before;
  const parsed = parseExpression(document.text, { sourceUri: document.uri });
  if (parsed.ok) state.analysis.syntax = parsed.value.syntax;
  else state.diagnostics.push(...parsed.diagnostics);
  const after = cancelledAt("after-parse", cancellation);
  return after ?? Object.freeze({ cancelled: false, value: parsed.ok ? parsed.value : null });
}

function compilePhase(
  state: PhaseState,
  parsed: ParsedExpression,
  environment: NormalizedEnvironment,
  cancellation?: CancellationToken,
): Stage<CompiledExpression | null> {
  const before = cancelledAt("before-compile", cancellation);
  if (before) return before;
  const compiled = compileExpression(parsed, environment.compileProjection);
  if (compiled.ok) captureCompilation(state.analysis, compiled.value);
  else state.diagnostics.push(...compiled.diagnostics);
  const after = cancelledAt("after-compile", cancellation);
  return after ?? Object.freeze({ cancelled: false, value: compiled.ok ? compiled.value : null });
}

function captureCompilation(analysis: MutableAnalysis, compiled: CompiledExpression): void {
  analysis.program = compiled.program;
  analysis.sourceMap = compiled.sourceMap;
}

function linkPhase(
  state: PhaseState,
  compiled: CompiledExpression,
  environment: NormalizedEnvironment,
  snapshot: CapabilitySnapshot,
  cancellation?: CancellationToken,
): Cancellation | null {
  const before = cancelledAt("before-link", cancellation);
  if (before) return before;
  collectLinkDiagnostics(state, linkExpression(compiled, environment, snapshot));
  return cancelledAt("after-link", cancellation);
}

function collectLinkDiagnostics(
  state: PhaseState,
  linked: ReturnType<typeof linkExpression>,
): void {
  if (!linked.ok) state.diagnostics.push(...linked.diagnostics);
}

function finish(state: PhaseState, cancellation?: CancellationToken): PhaseRun {
  const complete = cancelledAt("complete", cancellation);
  if (complete) return complete;
  return Object.freeze({
    cancelled: false,
    diagnostics: Object.freeze(state.diagnostics),
    analysis: Object.freeze(state.analysis),
  });
}

function cancelledAt(
  checkpoint: AnalysisCheckpoint,
  cancellation?: CancellationToken,
): Cancellation | null {
  return cancellation?.isCancellationRequested()
    ? Object.freeze({ cancelled: true, checkpoint })
    : null;
}

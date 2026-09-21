import type { NormalizedEnvironment } from "@kalada/host";
import {
  type KaladaReferenceBinding,
  type KaladaSyntaxDiagnostic,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";
import type {
  AnalysisCheckpoint,
  CancellationToken,
  DocumentSnapshot,
  EnvironmentSnapshot,
  LanguageAnalysis,
  LanguageServiceDiagnostic,
} from "./contracts.js";

export type PhaseRun =
  | Readonly<{
      cancelled: true;
      checkpoint: AnalysisCheckpoint;
    }>
  | Readonly<{
      cancelled: false;
      diagnostics: readonly LanguageServiceDiagnostic[];
      analysis: LanguageAnalysis;
    }>;

export function runAnalysisPhases(
  document: DocumentSnapshot,
  environment: EnvironmentSnapshot,
  cancellation?: CancellationToken,
): PhaseRun {
  const captured = cancelledAt("captured", cancellation);
  if (captured) return captured;
  const diagnostics = environmentDiagnostics(environment);
  const environmentCheckpoint = cancelledAt("environment", cancellation);
  if (environmentCheckpoint) return environmentCheckpoint;
  const syntax = parseKaladaV1Expression(document.text);
  diagnostics.push(...syntax.diagnostics.map((cause) => syntaxDiagnostic(cause, document)));
  const parsed = cancelledAt("parsed", cancellation);
  if (parsed) return parsed;
  const analysis: MutableAnalysis = { syntax };
  lowerWhenAvailable(analysis, diagnostics, document, environment);
  const lowered = cancelledAt("lowered", cancellation);
  if (lowered) return lowered;
  const complete = cancelledAt("complete", cancellation);
  if (complete) return complete;
  return Object.freeze({
    cancelled: false,
    diagnostics: Object.freeze(diagnostics),
    analysis: Object.freeze(analysis),
  });
}

interface MutableAnalysis extends LanguageAnalysis {
  environment?: NormalizedEnvironment;
  program?: NonNullable<LanguageAnalysis["program"]>;
  sourceMap?: NonNullable<LanguageAnalysis["sourceMap"]>;
}

function lowerWhenAvailable(
  analysis: MutableAnalysis,
  diagnostics: LanguageServiceDiagnostic[],
  document: DocumentSnapshot,
  environment: EnvironmentSnapshot,
): void {
  if (!environment.description.ok || analysis.syntax.diagnostics.length > 0) return;
  analysis.environment = environment.description.environment;
  const lowered = lowerKaladaV1Expression(analysis.syntax, {
    references: referenceBindings(environment.description.environment),
  });
  if (!lowered.ok) {
    diagnostics.push(...lowered.diagnostics.map((cause) => syntaxDiagnostic(cause, document)));
    return;
  }
  analysis.program = lowered.program;
  analysis.sourceMap = lowered.sourceMap;
}

function environmentDiagnostics(environment: EnvironmentSnapshot): LanguageServiceDiagnostic[] {
  return environment.description.ok
    ? []
    : [...(environment.description.diagnostics as readonly LanguageServiceDiagnostic[])];
}

function referenceBindings(
  environment: NormalizedEnvironment,
): Record<string, KaladaReferenceBinding<string>> {
  const references: Record<string, KaladaReferenceBinding<string>> = Object.create(null);
  for (const binding of environment.bindings) {
    references[binding.name] = { reference: binding.id, type: binding.semanticType };
  }
  return references;
}

function syntaxDiagnostic(
  cause: KaladaSyntaxDiagnostic,
  document: DocumentSnapshot,
): LanguageServiceDiagnostic {
  return Object.freeze({
    code: cause.code,
    phase: cause.phase === "lower" ? "lower" : "parse",
    message: cause.message,
    source: Object.freeze({
      uri: document.uri,
      range: Object.freeze({
        start: document.lineIndex.positionAt(cause.range.start),
        end: document.lineIndex.positionAt(cause.range.end),
      }),
    }),
    cause,
  });
}

function cancelledAt(
  checkpoint: AnalysisCheckpoint,
  cancellation?: CancellationToken,
): Extract<PhaseRun, { cancelled: true }> | null {
  return cancellation?.isCancellationRequested()
    ? Object.freeze({ cancelled: true, checkpoint })
    : null;
}

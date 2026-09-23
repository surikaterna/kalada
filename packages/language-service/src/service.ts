import type { Utf16Position } from "@kalada/host";
import {
  formatKaladaV1Expression,
  type KaladaSyntaxDiagnostic,
  parseKaladaV1Expression,
} from "@kalada/syntax";
import { runAnalysisPhases } from "./analysis.js";
import type {
  AnalysisOutcome,
  CancellationToken,
  CancelledResult,
  CompletionOutcome,
  DiagnosticsOutcome,
  DocumentOpen,
  DocumentSnapshot,
  DocumentUpdate,
  EnvironmentSnapshot,
  EnvironmentUpdate,
  FormatCheckpoint,
  FormatOutcome,
  HighlightOutcome,
  HoverOutcome,
  LanguageService,
  LanguageServiceCheckpoint,
  LanguageServiceDiagnostic,
  LanguageServiceOperation,
  RequestOptions,
  ResultStatus,
  SnapshotIdentity,
  WorkspaceSnapshot,
} from "./contracts.js";
import { DocumentStore, validVersion } from "./documents.js";
import { LanguageServiceError } from "./errors.js";
import { classifyHighlight } from "./highlight.js";
import { runCompletion, runHover } from "./tooling.js";

export function createLanguageService(initial: EnvironmentUpdate): LanguageService {
  return new LanguageServiceInstance(initial);
}

class LanguageServiceInstance implements LanguageService {
  private readonly store = new DocumentStore();
  private environment: EnvironmentSnapshot;

  constructor(initial: EnvironmentUpdate) {
    this.environment = snapshotEnvironment(initial);
  }

  openDocument(input: DocumentOpen): DocumentSnapshot {
    return this.store.open(input);
  }

  updateDocument(input: DocumentUpdate): DocumentSnapshot {
    return this.store.update(input);
  }

  closeDocument(uri: string): DocumentSnapshot {
    return this.store.close(uri);
  }

  getDocument(uri: string): DocumentSnapshot | undefined {
    return this.store.documents.get(uri);
  }

  updateEnvironment(input: EnvironmentUpdate): EnvironmentSnapshot {
    const snapshot = snapshotEnvironment(input);
    const expected = this.environment;
    this.assertEnvironmentGeneration(snapshot.generation);
    return this.commitEnvironment(snapshot, expected);
  }

  getEnvironment(): EnvironmentSnapshot {
    return this.environment;
  }

  getWorkspaceSnapshot(): WorkspaceSnapshot {
    const documents = [...this.store.documents.values()]
      .map(({ uri, version }) => Object.freeze({ uri, version }))
      .sort(compareDocumentIdentity);
    return Object.freeze({
      environmentGeneration: this.environment.generation,
      documents: Object.freeze(documents),
    });
  }

  analyze(uri: string, options?: RequestOptions): AnalysisOutcome {
    return this.runAnalysis("analyze", uri, options);
  }

  diagnostics(uri: string, options?: RequestOptions): DiagnosticsOutcome {
    return this.runAnalysis("diagnostics", uri, options);
  }

  format(uri: string, options?: RequestOptions): FormatOutcome {
    const captured = this.capture(uri);
    const first = this.formatCancellation("captured", captured.identity, options?.cancellation);
    if (first) return first;
    const formatted = formatKaladaV1Expression(captured.document.text);
    const second = this.formatCancellation("formatted", captured.identity, options?.cancellation);
    if (second) return second;
    const final = this.formatCancellation("complete", captured.identity, options?.cancellation);
    if (final) return final;
    return this.formatResult(captured.document, captured.identity, formatted);
  }

  highlight(uri: string, options?: RequestOptions): HighlightOutcome {
    const captured = this.capture(uri);
    const cancelled = (checkpoint: "captured" | "before-parse" | "after-parse" | "complete") =>
      options?.cancellation?.isCancellationRequested()
        ? this.cancelled("highlight", captured.identity, checkpoint)
        : null;
    const first = cancelled("captured") ?? cancelled("before-parse");
    if (first) return first;
    const parsed = parseKaladaV1Expression(captured.document.text);
    const second = cancelled("after-parse");
    if (second) return second;
    const spans = classifyHighlight(parsed);
    const final = cancelled("complete");
    if (final) return final;
    return Object.freeze({
      kind: "highlight",
      ...captured.identity,
      status: this.status(captured.identity),
      spans,
    });
  }

  completion(uri: string, position: Utf16Position, options?: RequestOptions): CompletionOutcome {
    const captured = this.capture(uri);
    const run = runCompletion(
      captured.document,
      captured.environment,
      position,
      options?.cancellation,
    );
    if (run.cancelled) return this.cancelled("completion", captured.identity, run.checkpoint);
    return Object.freeze({
      ...run.value,
      ...captured.identity,
      status: this.status(captured.identity),
    });
  }

  hover(uri: string, position: Utf16Position, options?: RequestOptions): HoverOutcome {
    const captured = this.capture(uri);
    const run = runHover(captured.document, captured.environment, position, options?.cancellation);
    if (run.cancelled) return this.cancelled("hover", captured.identity, run.checkpoint);
    return Object.freeze({
      ...run.value,
      ...captured.identity,
      status: this.status(captured.identity),
    });
  }

  isCurrent(identity: SnapshotIdentity): boolean {
    const document = this.store.documents.get(identity.uri);
    return (
      document?.version === identity.version &&
      this.environment.generation === identity.environmentGeneration
    );
  }

  isWorkspaceCurrent(snapshot: WorkspaceSnapshot): boolean {
    if (snapshot.environmentGeneration !== this.environment.generation) return false;
    const current = this.getWorkspaceSnapshot().documents;
    return (
      current.length === snapshot.documents.length &&
      current.every(sameDocument(snapshot.documents))
    );
  }

  private runAnalysis(operation: "analyze", uri: string, options?: RequestOptions): AnalysisOutcome;
  private runAnalysis(
    operation: "diagnostics",
    uri: string,
    options?: RequestOptions,
  ): DiagnosticsOutcome;
  private runAnalysis(
    operation: "analyze" | "diagnostics",
    uri: string,
    options?: RequestOptions,
  ): AnalysisOutcome | DiagnosticsOutcome {
    const captured = this.capture(uri);
    const run = runAnalysisPhases(captured.document, captured.environment, options?.cancellation);
    if (run.cancelled) return this.cancelled(operation, captured.identity, run.checkpoint);
    const base = Object.freeze({ ...captured.identity, status: this.status(captured.identity) });
    if (operation === "diagnostics") {
      return Object.freeze({ kind: "diagnostics", ...base, diagnostics: run.diagnostics });
    }
    return Object.freeze({
      kind: "analysis",
      ...base,
      diagnostics: run.diagnostics,
      analysis: run.analysis,
    });
  }

  private capture(uri: string) {
    const document = this.store.require(uri);
    const environment = this.environment;
    const identity = Object.freeze({
      uri: document.uri,
      version: document.version,
      environmentGeneration: environment.generation,
    });
    return { document, environment, identity };
  }

  private cancelled(
    operation: LanguageServiceOperation,
    identity: SnapshotIdentity,
    checkpoint: LanguageServiceCheckpoint,
  ): CancelledResult {
    return Object.freeze({
      kind: "cancelled",
      operation,
      checkpoint,
      ...identity,
      status: this.status(identity),
    });
  }

  private formatCancellation(
    checkpoint: FormatCheckpoint,
    identity: SnapshotIdentity,
    cancellation?: CancellationToken,
  ): CancelledResult | null {
    return cancellation?.isCancellationRequested()
      ? this.cancelled("format", identity, checkpoint)
      : null;
  }

  private formatResult(
    document: DocumentSnapshot,
    identity: SnapshotIdentity,
    formatted: ReturnType<typeof formatKaladaV1Expression>,
  ): FormatOutcome {
    const diagnostics = formatted.ok
      ? []
      : formatted.diagnostics.map((cause) => formatDiagnostic(cause, document));
    const edit =
      formatted.ok && formatted.text !== document.text
        ? wholeDocumentEdit(document, formatted.text)
        : null;
    return Object.freeze({
      kind: "format",
      ...identity,
      status: this.status(identity),
      diagnostics: Object.freeze(diagnostics),
      edit,
    });
  }

  private status(identity: SnapshotIdentity): ResultStatus {
    return this.isCurrent(identity) ? "current" : "stale";
  }

  private assertEnvironmentGeneration(generation: number): void {
    if (generation <= this.environment.generation) {
      throw new LanguageServiceError("ENVIRONMENT_GENERATION_NOT_MONOTONIC");
    }
  }

  private commitEnvironment(
    snapshot: EnvironmentSnapshot,
    expected: EnvironmentSnapshot,
  ): EnvironmentSnapshot {
    if (this.environment !== expected) {
      throw new LanguageServiceError("ENVIRONMENT_GENERATION_NOT_MONOTONIC");
    }
    this.assertEnvironmentGeneration(snapshot.generation);
    this.environment = snapshot;
    return snapshot;
  }
}

function snapshotEnvironment(input: EnvironmentUpdate): EnvironmentSnapshot {
  try {
    const generation = input.generation;
    const description = input.description;
    validVersion(generation);
    if (typeof description !== "object" || description === null) {
      throw new TypeError("Environment description must be an object");
    }
    return Object.freeze({ generation, description });
  } catch (error) {
    if (error instanceof LanguageServiceError || error instanceof TypeError) throw error;
    throw new TypeError("Environment input could not be read");
  }
}

function compareDocumentIdentity(
  left: Readonly<{ uri: string }>,
  right: Readonly<{ uri: string }>,
): number {
  if (left.uri < right.uri) return -1;
  if (left.uri > right.uri) return 1;
  return 0;
}

function sameDocument(expected: readonly { uri: string; version: number }[]) {
  return (document: { uri: string; version: number }, index: number) => {
    const other = expected[index];
    return document.uri === other?.uri && document.version === other.version;
  };
}

function wholeDocumentEdit(document: DocumentSnapshot, text: string) {
  return Object.freeze({
    range: Object.freeze({
      start: Object.freeze({ line: 0, character: 0 }),
      end: document.lineIndex.positionAt(document.text.length),
    }),
    text,
  });
}

function formatDiagnostic(
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

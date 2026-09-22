import type { JsonValue, KaladaV1Program } from "@kalada/core";
import type {
  DescribeEnvironmentResult,
  HostDiagnostic,
  NormalizedEnvironment,
  Utf16Position,
  Utf16Range,
} from "@kalada/host";
import type { KaladaParseResult, KaladaSourceMapEntry } from "@kalada/syntax";

export interface DocumentIdentity {
  readonly uri: string;
  readonly version: number;
}

export interface SnapshotIdentity extends DocumentIdentity {
  readonly environmentGeneration: number;
}

export interface Utf16LineIndex {
  readonly lineCount: number;
  readonly positionAt: (offset: number) => Utf16Position;
  readonly offsetAt: (position: Utf16Position) => number;
}

export interface DocumentSnapshot extends DocumentIdentity {
  readonly text: string;
  readonly lineIndex: Utf16LineIndex;
}

export interface DocumentOpen extends DocumentIdentity {
  readonly text: string;
}

export interface TextEdit {
  readonly range: Utf16Range;
  readonly text: string;
}

export interface DocumentUpdate {
  readonly uri: string;
  readonly version: number;
  readonly edits: readonly TextEdit[];
}

export interface EnvironmentUpdate {
  readonly generation: number;
  readonly description: DescribeEnvironmentResult;
}

export interface EnvironmentSnapshot extends EnvironmentUpdate {}

export interface WorkspaceSnapshot {
  readonly environmentGeneration: number;
  readonly documents: readonly DocumentIdentity[];
}

export type AnalysisCheckpoint =
  | "captured"
  | "environment"
  | "before-parse"
  | "after-parse"
  | "before-compile"
  | "after-compile"
  | "before-link"
  | "after-link"
  | "complete";

export type FormatCheckpoint = "captured" | "formatted" | "complete";
export type LanguageServiceCheckpoint = AnalysisCheckpoint | FormatCheckpoint;

export interface CancellationToken {
  readonly isCancellationRequested: () => boolean;
}

export interface RequestOptions {
  readonly cancellation?: CancellationToken;
}

export type ResultStatus = "current" | "stale";
export type LanguageServiceOperation = "analyze" | "diagnostics" | "format";

export interface CancelledResult extends SnapshotIdentity {
  readonly kind: "cancelled";
  readonly operation: LanguageServiceOperation;
  readonly checkpoint: LanguageServiceCheckpoint;
  readonly status: ResultStatus;
}

export type LanguageServiceDiagnostic = HostDiagnostic;

export interface LanguageAnalysis<R extends JsonValue = string> {
  readonly syntax?: KaladaParseResult;
  readonly environment?: NormalizedEnvironment;
  readonly program?: KaladaV1Program<R>;
  readonly sourceMap?: readonly KaladaSourceMapEntry[];
}

export interface AnalysisResult extends SnapshotIdentity {
  readonly kind: "analysis";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly analysis: LanguageAnalysis;
}

export interface DiagnosticsResult extends SnapshotIdentity {
  readonly kind: "diagnostics";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
}

export interface FormatResult extends SnapshotIdentity {
  readonly kind: "format";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly edit: TextEdit | null;
}

export type AnalysisOutcome = AnalysisResult | CancelledResult;
export type DiagnosticsOutcome = DiagnosticsResult | CancelledResult;
export type FormatOutcome = FormatResult | CancelledResult;

export interface LanguageService {
  readonly openDocument: (input: DocumentOpen) => DocumentSnapshot;
  readonly updateDocument: (input: DocumentUpdate) => DocumentSnapshot;
  readonly closeDocument: (uri: string) => DocumentSnapshot;
  readonly getDocument: (uri: string) => DocumentSnapshot | undefined;
  readonly updateEnvironment: (input: EnvironmentUpdate) => EnvironmentSnapshot;
  readonly getEnvironment: () => EnvironmentSnapshot;
  readonly getWorkspaceSnapshot: () => WorkspaceSnapshot;
  readonly analyze: (uri: string, options?: RequestOptions) => AnalysisOutcome;
  readonly diagnostics: (uri: string, options?: RequestOptions) => DiagnosticsOutcome;
  readonly format: (uri: string, options?: RequestOptions) => FormatOutcome;
  readonly isCurrent: (identity: SnapshotIdentity) => boolean;
  readonly isWorkspaceCurrent: (snapshot: WorkspaceSnapshot) => boolean;
}

export type LanguageServiceErrorCode =
  | "INVALID_URI"
  | "INVALID_VERSION"
  | "DUPLICATE_DOCUMENT"
  | "DOCUMENT_NOT_OPEN"
  | "VERSION_NOT_MONOTONIC"
  | "INVALID_RANGE"
  | "OVERLAPPING_EDITS"
  | "ENVIRONMENT_GENERATION_NOT_MONOTONIC";

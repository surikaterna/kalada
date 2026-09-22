import type { JsonValue, KaladaV1Program } from "@kalada/core";
import type {
  DescribeEnvironmentResult,
  EditorNode,
  EditorScalarName,
  EditorUnknownCode,
  HostDiagnostic,
  HostPath,
  NormalizedEnvironment,
  Utf16Position,
  Utf16Range,
} from "@kalada/host";
import type {
  KaladaParseResult,
  KaladaSourceMapEntry,
  KaladaSyntaxStaticType,
} from "@kalada/syntax";

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
export type ToolingCheckpoint =
  | "captured"
  | "environment"
  | "before-parse"
  | "after-parse"
  | "context"
  | "before-query"
  | "after-query"
  | "complete";
export type LanguageServiceCheckpoint = AnalysisCheckpoint | FormatCheckpoint | ToolingCheckpoint;

export interface CancellationToken {
  readonly isCancellationRequested: () => boolean;
}

export interface RequestOptions {
  readonly cancellation?: CancellationToken;
}

export type ResultStatus = "current" | "stale";
export type LanguageServiceOperation =
  | "analyze"
  | "diagnostics"
  | "format"
  | "completion"
  | "hover";

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

export type ToolingEvidenceCode =
  | EditorUnknownCode
  | "unsupported-source-path"
  | "semantic-unknown"
  | "query-limit"
  | "opaque-wrapper";

export interface ToolingEvidence {
  readonly code: ToolingEvidenceCode;
  readonly path: HostPath;
}

export type CandidateSupport = "common" | "conditional";
export type CandidatePresence = "required" | "optional" | "unknown";

export interface CompletionItem {
  readonly label: string;
  readonly kind: "binding" | "property" | "operator";
  readonly edit: TextEdit;
  readonly support: CandidateSupport;
  readonly presence: CandidatePresence;
  readonly branches: readonly string[];
  readonly evidence: readonly ToolingEvidence[];
}

export interface CompletionResult extends SnapshotIdentity {
  readonly kind: "completion";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly items: readonly CompletionItem[];
  readonly incomplete: boolean;
  readonly evidence: readonly ToolingEvidence[];
}

export interface ShapeSummaryField {
  readonly name: string;
  readonly presence: CandidatePresence;
  readonly accessible: boolean;
}

export interface ShapeSummary {
  readonly kind: EditorNode["kind"];
  readonly path: HostPath;
  readonly presence: CandidatePresence;
  readonly branches: readonly string[];
  readonly fields: readonly ShapeSummaryField[];
  readonly provenance: readonly Readonly<{ providerId: string; providerVersion?: string }>[];
  readonly scalar?: EditorScalarName;
}

export interface HoverInfo {
  readonly range: Utf16Range;
  readonly input: readonly ShapeSummary[];
  readonly output: Readonly<{ type: KaladaSyntaxStaticType; known: boolean }>;
  readonly access: "supported" | "conditional" | "unsupported";
  readonly evidence: readonly ToolingEvidence[];
}

export interface HoverResult extends SnapshotIdentity {
  readonly kind: "hover";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly hover: HoverInfo | null;
  readonly incomplete: boolean;
  readonly evidence: readonly ToolingEvidence[];
}

export type AnalysisOutcome = AnalysisResult | CancelledResult;
export type DiagnosticsOutcome = DiagnosticsResult | CancelledResult;
export type FormatOutcome = FormatResult | CancelledResult;
export type CompletionOutcome = CompletionResult | CancelledResult;
export type HoverOutcome = HoverResult | CancelledResult;

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
  readonly completion: (
    uri: string,
    position: Utf16Position,
    options?: RequestOptions,
  ) => CompletionOutcome;
  readonly hover: (uri: string, position: Utf16Position, options?: RequestOptions) => HoverOutcome;
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

import type { Extension } from "@codemirror/state";

/** All offsets are half-open UTF-16 offsets in snapshot.text (including CRLF). */
export interface EditorRange {
  readonly from: number;
  readonly to: number;
}
export interface EditorEdit extends EditorRange {
  readonly text: string;
}
export interface EditorIdentity {
  readonly uri: string;
  readonly version: number;
  readonly environmentGeneration: number;
}
export interface EditorSnapshot extends EditorIdentity {
  readonly text: string;
}
export interface EditorRequest {
  readonly snapshot: EditorSnapshot;
  readonly signal: AbortSignal;
}
export interface EditorDiagnostic extends EditorRange {
  readonly message: string;
  readonly severity: "error" | "warning" | "info" | "hint";
}
export interface EditorCompletion {
  readonly label: string;
  readonly edit: EditorEdit;
  readonly type?: string;
  readonly detail?: string;
  readonly boost?: number;
}
export interface EditorHover extends EditorRange {
  readonly content:
    | string
    | readonly { readonly heading: string; readonly text: readonly string[] }[];
}
export interface EditorResult<T> extends EditorIdentity {
  readonly value: T;
}
export type EditorResponse<T> = EditorResult<T> | null | Promise<EditorResult<T> | null>;
/** Providers own language semantics and embedded-language routing, not editor lifecycle. */
export interface EditorProvider {
  readonly diagnostics?: (request: EditorRequest) => EditorResponse<readonly EditorDiagnostic[]>;
  readonly completion?: (
    request: EditorRequest,
    offset: number,
  ) => EditorResponse<readonly EditorCompletion[]>;
  readonly hover?: (request: EditorRequest, offset: number) => EditorResponse<EditorHover>;
  readonly format?: (request: EditorRequest) => EditorResponse<EditorEdit>;
}
export interface EditorSessionOptions {
  readonly document: { readonly uri: string; readonly version: number; readonly text: string };
  readonly provider?: EditorProvider;
  readonly ariaLabel?: string;
  readonly extensions?: Extension;
  readonly onDocumentChange?: (snapshot: EditorSnapshot) => void;
}
export interface EditorSession {
  readonly extension: Extension;
  readonly getSnapshot: () => EditorSnapshot;
  readonly refreshEnvironment: () => void;
  readonly replaceDocument: (text: string) => void;
  /** Sync providers return boolean; async providers return Promise<boolean>. */
  readonly format: () => boolean | Promise<boolean>;
  readonly dispose: () => void;
}

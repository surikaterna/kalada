/** Experimental host composition v1; offsets are UTF-16, half-open, in the original text. */
export const COMPOSITION_CONTRACT_VERSION = 1;

export interface CompositionSnapshot {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
  readonly environmentGeneration: string;
}
export interface CompositionRange {
  readonly start: number;
  readonly end: number;
}
export interface CompositionDiagnostic {
  readonly owner: string;
  readonly code: string;
  readonly range: CompositionRange;
}
export interface CompositionProfile {
  readonly version: 1;
  readonly hostLanguageId: string;
  readonly position: string;
  readonly allowedGuests: readonly string[];
  readonly defaultGuest?: string;
  /** Host grammar owns the opening and closing text; guest owns only the interior. */
  readonly open: string;
  readonly close: string;
}
export interface CompositionSlot {
  readonly position: string;
  readonly start: number; // start of host-owned opening marker
  /** Optional independent host-known upper bound for guest stop, including early failures; not inferred by scanning guest text. */
  readonly maxStop?: number;
  readonly explicitGuest?: string;
  /** Host-owned opaque facts; neither router nor guest may derive write authority from them. */
  readonly context?: Readonly<{ expectedType?: unknown; location?: unknown }>;
}
export interface CompositionMeter {
  /** Shared cumulative work: host charges its own text/markers; guest charges its interior and nested work. */
  readonly exhausted: boolean;
  readonly work: number;
  readonly depth: number;
  readonly diagnostics: number;
  charge(units: number): boolean;
  report(count: number): boolean;
  enter(): boolean;
  leave(): void;
}
export interface CompositionGuest {
  readonly languageId: string;
  parse(
    input: Readonly<{
      snapshot: CompositionSnapshot;
      start: number;
      close: string;
      context?: CompositionSlot["context"];
      meter: CompositionMeter;
    }>,
  ): GuestCompositionResult;
}
export interface GuestCompositionResult {
  readonly owner: string;
  readonly status: "valid" | "invalid" | "partial" | "unsupported";
  readonly range: CompositionRange;
  /** Valid: first applicable host close. Nonvalid: bounded failure stop (possibly start or EOF). Always equals range.end. */
  readonly stop: number;
  /** Success requires "host-close"; nonvalid results retain a nonempty guest reason without granting continuation. */
  readonly reason: string;
  readonly diagnostics: readonly CompositionDiagnostic[];
  readonly subtree?: unknown;
}
export interface CompositionNode {
  readonly owner: string;
  readonly range: CompositionRange;
  readonly children: readonly CompositionNode[];
  /** Opaque language-owned parsed subtree. Never interpreted by the host router. */
  readonly subtree?: unknown;
}
export interface CompositionOutcome {
  readonly status:
    | "valid"
    | "invalid"
    | "partial"
    | "unsupported"
    | "stale"
    | "cancelled"
    | "budget";
  readonly reason: string;
  readonly snapshot: CompositionSnapshot;
  readonly diagnostics: readonly CompositionDiagnostic[];
  readonly tree?: CompositionNode;
}
export interface CompositionRequest {
  readonly snapshot: CompositionSnapshot;
  /** Must consult the caller's live identity, including environment, on both sides of callbacks. */
  readonly isCurrent: (snapshot: CompositionSnapshot) => boolean;
  readonly isCancelled?: () => boolean;
  readonly hostLanguageId: string;
  readonly slots: readonly CompositionSlot[];
  readonly limits: Readonly<{ work: number; depth: number; diagnostics: number }>;
  /** For a nested request, pass the parent's meter rather than allocating a fresh budget. */
  readonly meter?: CompositionMeter;
}

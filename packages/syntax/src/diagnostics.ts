import type { KaladaSourceRange } from "./cst-types.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import type {
  KaladaSyntaxDiagnostic,
  KaladaSyntaxDiagnosticCode,
  KaladaSyntaxLimits,
} from "./public-types.js";

export const KALADA_SYNTAX_DIAGNOSTIC_MESSAGES = Object.freeze({
  KALADA_SYNTAX_INVALID_INPUT: "Kalada syntax input is invalid.",
  KALADA_SYNTAX_LIMIT_EXCEEDED: "Kalada syntax input exceeds a configured limit.",
  KALADA_SYNTAX_UNEXPECTED_TOKEN: "Kalada syntax contains an unexpected token.",
  KALADA_SYNTAX_EXPECTED_EXPRESSION: "Kalada syntax expected an expression.",
  KALADA_SYNTAX_EXPECTED_FIELD: "Kalada syntax expected a field name.",
  KALADA_SYNTAX_EXPECTED_RIGHT_PARENTHESIS: "Kalada syntax expected a closing parenthesis.",
  KALADA_SYNTAX_EXPECTED_COLON: "Kalada syntax expected a colon.",
  KALADA_SYNTAX_INVALID_NUMBER: "Kalada syntax contains an invalid JSON number.",
  KALADA_SYNTAX_INVALID_STRING: "Kalada syntax contains an invalid JSON string.",
  KALADA_SYNTAX_UNSUPPORTED_FORM: "Kalada syntax form is not supported.",
  KALADA_SYNTAX_UNSUPPORTED_OPERATOR: "Kalada syntax operator is not supported.",
  KALADA_SYNTAX_RELATIONAL_CHAIN: "Kalada relational and membership operators cannot be chained.",
  KALADA_SYNTAX_COALESCE_LOGICAL_MIX:
    "Kalada null coalescing cannot be mixed with && or || without parentheses.",
  KALADA_SYNTAX_UNKNOWN_REFERENCE: "Kalada reference is not present in the lowering environment.",
} satisfies Readonly<Record<KaladaSyntaxDiagnosticCode, string>>);

export class DiagnosticSink {
  readonly diagnostics: KaladaSyntaxDiagnostic[];
  readonly limits: KaladaSyntaxLimits;
  private limitIndex: number | null;

  constructor(limits: KaladaSyntaxLimits, initial: readonly KaladaSyntaxDiagnostic[] = []) {
    this.limits = limits;
    this.diagnostics = [...initial];
    const limitIndex = initial.findIndex((item) => item.code === "KALADA_SYNTAX_LIMIT_EXCEEDED");
    this.limitIndex = limitIndex < 0 ? null : limitIndex;
  }

  add(
    phase: KaladaSyntaxDiagnostic["phase"],
    code: KaladaSyntaxDiagnosticCode,
    range: KaladaSourceRange,
    path: readonly (string | number)[] = [],
  ): void {
    if (this.diagnostics.length >= this.limits.maxDiagnostics) {
      if (this.limitIndex === null) this.limit(phase, range);
      return;
    }
    this.diagnostics.push(
      diagnostic(phase, code, KALADA_SYNTAX_DIAGNOSTIC_MESSAGES[code], range, path),
    );
  }

  limit(phase: KaladaSyntaxDiagnostic["phase"], range: KaladaSourceRange): void {
    const current = this.limitIndex === null ? undefined : this.diagnostics[this.limitIndex];
    if (current && current.range.start <= range.start) return;
    const problem = diagnostic(
      phase,
      "KALADA_SYNTAX_LIMIT_EXCEEDED",
      KALADA_SYNTAX_DIAGNOSTIC_MESSAGES.KALADA_SYNTAX_LIMIT_EXCEEDED,
      range,
      [],
    );
    if (this.limitIndex !== null) {
      this.diagnostics.splice(this.limitIndex, 1, problem);
      return;
    }
    if (this.diagnostics.length >= this.limits.maxDiagnostics) {
      this.diagnostics.splice(-1, 1, problem);
      this.limitIndex = this.diagnostics.length - 1;
      return;
    }
    this.diagnostics.push(problem);
    this.limitIndex = this.diagnostics.length - 1;
  }

  hasLexicalLimitAt(start: number): boolean {
    return this.diagnostics.some(
      (item) =>
        item.phase === "lex" &&
        item.code === "KALADA_SYNTAX_LIMIT_EXCEEDED" &&
        item.range.start === start,
    );
  }
}

export function diagnostic(
  phase: KaladaSyntaxDiagnostic["phase"],
  code: KaladaSyntaxDiagnostic["code"],
  message: string,
  range: KaladaSourceRange,
  path: readonly (string | number)[],
): KaladaSyntaxDiagnostic {
  return deepFreeze({
    phase,
    code,
    message,
    range: freezeRange(range.start, range.end),
    path: [...path],
  });
}

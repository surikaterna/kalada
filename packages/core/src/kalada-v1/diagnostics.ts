import type { KaladaV1Diagnostic, KaladaV1DiagnosticCode, KaladaV1Outcome } from "./types.js";

const MESSAGES: Readonly<Record<KaladaV1DiagnosticCode, string>> = Object.freeze({
  KALADA_INVALID_INPUT: "Kalada program input is invalid.",
  KALADA_LIMIT_EXCEEDED: "Kalada program input exceeds a configured limit.",
  KALADA_INVALID_REFERENCE: "Kalada reference is invalid.",
  KALADA_MATCH_MISSING_ARM: "Kalada match is missing a required arm.",
  KALADA_MATCH_DUPLICATE_ARM: "Kalada match contains a duplicate arm.",
  KALADA_MATCH_UNKNOWN_ARM: "Kalada match contains an unknown arm.",
  KALADA_MATCH_UNREACHABLE_ARM: "Kalada match contains an unreachable arm.",
  KALADA_MATCH_TYPE_MISMATCH: "Kalada match received the wrong value type.",
  KALADA_REFERENCE_ERROR: "Kalada reference resolution failed.",
  KALADA_REFERENCE_MISSING: "Kalada reference is missing.",
  KALADA_REFERENCE_DENIED: "Kalada reference access was denied.",
  KALADA_ASYNC_UNSUPPORTED: "Kalada callbacks must return synchronously.",
  KALADA_INVALID_RESULT: "Kalada reference callback returned an invalid value.",
  KALADA_EVALUATION_LIMIT: "Kalada evaluation exceeded its configured step limit.",
});

export class KaladaFailure extends Error {
  readonly code: KaladaV1DiagnosticCode;
  readonly path: readonly (string | number)[];

  constructor(code: KaladaV1DiagnosticCode, path: readonly (string | number)[]) {
    super(code);
    this.code = code;
    this.path = path;
  }
}

export function failure<T>(
  code: KaladaV1DiagnosticCode,
  path: readonly (string | number)[],
): KaladaV1Outcome<T> {
  const diagnostic: KaladaV1Diagnostic = Object.freeze({
    code,
    path: Object.freeze([...path]),
    message: MESSAGES[code],
  });
  return Object.freeze({ ok: false, diagnostic });
}

export function success<T>(value: T): KaladaV1Outcome<T> {
  return Object.freeze({ ok: true, value });
}

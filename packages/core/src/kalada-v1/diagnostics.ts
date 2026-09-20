import type {
  KaladaV1Diagnostic,
  KaladaV1DiagnosticCode,
  KaladaV1DiagnosticContextFrame,
  KaladaV1Outcome,
} from "./types.js";

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
  KALADA_INSTANT_REQUIRED: "Kalada evaluation requires an explicit current Instant.",
  KALADA_TEMPORAL_TYPE_MISMATCH: "Kalada temporal operation received incompatible values.",
  KALADA_TEMPORAL_OVERFLOW: "Kalada temporal arithmetic exceeded safe integer milliseconds.",
  KALADA_CLOCK_ERROR: "Kalada clock sampling failed.",
  KALADA_INVALID_CLOCK: "Kalada clock returned an invalid Instant.",
  KALADA_DUPLICATE_BINDING: "Kalada function contains a duplicate binding.",
  KALADA_INVALID_FUNCTION_TYPE: "Kalada function type is invalid.",
  KALADA_CAPTURE_LIMIT: "Kalada function captures exceed a configured limit.",
  KALADA_NOT_CALLABLE: "Kalada call target is not callable.",
  KALADA_FUNCTION_ARITY: "Kalada call has the wrong number of arguments.",
  KALADA_FUNCTION_TYPE_MISMATCH: "Kalada function type does not match.",
  KALADA_CLOSURE_LIMIT: "Kalada closure count exceeds a configured limit.",
  KALADA_CALL_DEPTH_LIMIT: "Kalada call depth exceeds a configured limit.",
  KALADA_CONTINUATION_LIMIT: "Kalada continuation count exceeds a configured limit.",
  KALADA_COLLECTION_TYPE_MISMATCH: "Kalada collection function received an incompatible value.",
  KALADA_COLLECTION_LIMIT: "Kalada collection exceeds a configured limit.",
  KALADA_FUNCTION_ESCAPE: "Kalada callable cannot escape evaluation.",
  KALADA_FIELD_MISSING: "Kalada field does not exist.",
  KALADA_FIELD_TYPE_MISMATCH: "Kalada field access requires a JSON object.",
  KALADA_OPERATOR_TYPE: "Kalada operator received an incompatible value.",
  KALADA_OPERATOR_AMBIGUOUS: "Kalada operator domain is ambiguous.",
});

export class KaladaFailure extends Error {
  readonly code: KaladaV1DiagnosticCode;
  readonly path: readonly (string | number)[];
  readonly context?: readonly KaladaV1DiagnosticContextFrame[];

  constructor(
    code: KaladaV1DiagnosticCode,
    path: readonly (string | number)[],
    context?: readonly KaladaV1DiagnosticContextFrame[],
  ) {
    super(code);
    this.code = code;
    this.path = path;
    this.context = context;
  }
}

export function failure<T>(
  code: KaladaV1DiagnosticCode,
  path: readonly (string | number)[],
  context?: readonly KaladaV1DiagnosticContextFrame[],
): KaladaV1Outcome<T> {
  const diagnostic: KaladaV1Diagnostic = Object.freeze({
    code,
    path: Object.freeze([...path]),
    message: MESSAGES[code],
    ...(context === undefined ? {} : { context: freezeContext(context) }),
  });
  return Object.freeze({ ok: false, diagnostic });
}

function freezeContext(
  context: readonly KaladaV1DiagnosticContextFrame[],
): readonly KaladaV1DiagnosticContextFrame[] {
  return Object.freeze(
    context.map((frame) => Object.freeze({ ...frame, path: Object.freeze([...frame.path]) })),
  );
}

export function success<T>(value: T): KaladaV1Outcome<T> {
  return Object.freeze({ ok: true, value });
}

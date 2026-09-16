import type {
  ExpressionDiagnostic,
  ExpressionDiagnosticCode,
  ExpressionPath,
  Result,
} from "./types.js";

const MESSAGES: Readonly<Record<ExpressionDiagnosticCode, string>> = Object.freeze({
  EXPRESSION_INVALID_INPUT: "Expression input is invalid.",
  EXPRESSION_LIMIT_EXCEEDED: "Expression input exceeds a configured limit.",
  EXPRESSION_INVALID_REFERENCE: "Expression reference is invalid.",
  EXPRESSION_UNKNOWN_OPERATOR: "Expression operator is not in the selected profile.",
  EXPRESSION_INVALID_ARITY: "Expression operator has an invalid number of arguments.",
  EXPRESSION_TYPE_MISMATCH: "Expression operator received an incompatible value type.",
  EXPRESSION_DIVISION_BY_ZERO: "Expression division by zero is not allowed.",
  EXPRESSION_NON_FINITE_RESULT: "Expression arithmetic produced a non-finite result.",
  EXPRESSION_REFERENCE_ERROR: "Expression reference resolution failed.",
  EXPRESSION_REFERENCE_MISSING: "Expression reference is missing.",
  EXPRESSION_REFERENCE_DENIED: "Expression reference access was denied.",
  EXPRESSION_OPERATOR_ERROR: "Expression operator evaluation failed.",
  EXPRESSION_ASYNC_UNSUPPORTED: "Expression callbacks must return synchronously.",
  EXPRESSION_EVALUATION_LIMIT: "Expression evaluation exceeded its configured cost limit.",
  EXPRESSION_INVALID_RESULT: "Expression callback returned an invalid JSON value.",
});

export function diagnostic(
  code: ExpressionDiagnosticCode,
  path: ExpressionPath,
): ExpressionDiagnostic {
  return Object.freeze({ code, path: Object.freeze([...path]), message: MESSAGES[code] });
}

export function failure<T>(code: ExpressionDiagnosticCode, path: ExpressionPath): Result<T> {
  return Object.freeze({ ok: false, diagnostic: diagnostic(code, path) });
}

export function success<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

export class ExpressionFailure extends Error {
  readonly code: ExpressionDiagnosticCode;
  readonly expressionPath: ExpressionPath;

  constructor(code: ExpressionDiagnosticCode, expressionPath: ExpressionPath) {
    super(code);
    this.code = code;
    this.expressionPath = expressionPath;
  }
}

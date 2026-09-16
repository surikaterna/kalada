/** JSON data accepted and produced by the strict expression API. */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

/** A literal, opaque reference, or operator application. */
export type ValueExpression<R extends JsonValue = string> =
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "ref"; readonly ref: R }
  | { readonly kind: "op"; readonly op: string; readonly args: readonly ValueExpression<R>[] };

export type ExpressionPath = readonly (string | number)[];

export type ExpressionDiagnosticCode =
  | "EXPRESSION_INVALID_INPUT"
  | "EXPRESSION_LIMIT_EXCEEDED"
  | "EXPRESSION_INVALID_REFERENCE"
  | "EXPRESSION_UNKNOWN_OPERATOR"
  | "EXPRESSION_INVALID_ARITY"
  | "EXPRESSION_TYPE_MISMATCH"
  | "EXPRESSION_DIVISION_BY_ZERO"
  | "EXPRESSION_NON_FINITE_RESULT"
  | "EXPRESSION_REFERENCE_ERROR"
  | "EXPRESSION_REFERENCE_MISSING"
  | "EXPRESSION_REFERENCE_DENIED"
  | "EXPRESSION_OPERATOR_ERROR"
  | "EXPRESSION_ASYNC_UNSUPPORTED"
  | "EXPRESSION_EVALUATION_LIMIT"
  | "EXPRESSION_INVALID_RESULT";

export interface ExpressionDiagnostic {
  readonly code: ExpressionDiagnosticCode;
  readonly path: ExpressionPath;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: ExpressionDiagnostic };

export interface ExpressionLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArgs: number;
  readonly maxStringLength: number;
  readonly maxReferenceLength: number;
  readonly maxEvaluationSteps: number;
}

export interface ReferenceCodec<R extends JsonValue> {
  readonly validate: (input: unknown) => input is R;
  readonly canonicalize?: (reference: R) => R;
}

export interface CanonicalizeExpressionOptions<R extends JsonValue> {
  readonly reference?: ReferenceCodec<R>;
  readonly limits?: Partial<ExpressionLimits>;
}

export type ReferenceResolution =
  | { readonly found: true; readonly value: JsonValue }
  | { readonly found: false; readonly reason?: "missing" | "denied" | undefined };

/** Trusted host callback. Throwing and asynchronous outcomes are contained as diagnostics. */
export type ReferenceResolver<R extends JsonValue> = (reference: R) => ReferenceResolution;

export interface CompiledExpression<R extends JsonValue> {
  readonly expression: ValueExpression<R>;
  readonly dependencies: readonly R[];
  evaluate(resolve: ReferenceResolver<R>): Result<JsonValue>;
}

import type { JsonValue } from "./json.js";
import type { InstantValue } from "./temporal.js";
import type { KaladaValue } from "./values.js";

export type KaladaV1Expression<R extends JsonValue = string> =
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "ref"; readonly ref: R }
  | BindingExpression<R>
  | OptionExpression<R>
  | ResultExpression<R>
  | MatchExpression<R>
  | InstantExpression
  | DurationExpression
  | CurrentInstantExpression
  | TemporalArithmeticExpression<R>
  | TemporalComparisonExpression<R>
  | FieldAccessExpression<R>
  | OptionalFieldAccessExpression<R>
  | EqualityExpression<R>
  | OrderedComparisonExpression<R>
  | MembershipExpression<R>
  | NumericBinaryExpression<R>
  | NumericUnaryExpression<R>
  | BooleanNotExpression<R>
  | BooleanLogicalExpression<R>
  | BooleanXorExpression<R>
  | FunctionExpression<R>
  | CallExpression<R>
  | FunctionGroupExpression<R>
  | CoreFunctionExpression;

export type KaladaPrimitiveTypeName =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "json"
  | "Instant"
  | "Duration";

export type KaladaType =
  | { readonly kind: "primitive-type"; readonly name: KaladaPrimitiveTypeName }
  | { readonly kind: "option-type"; readonly value: KaladaType }
  | { readonly kind: "result-type"; readonly ok: KaladaType; readonly error: KaladaType }
  | { readonly kind: "array-type"; readonly element: KaladaType }
  | KaladaFunctionType;

export interface KaladaFunctionType {
  readonly kind: "function-type";
  readonly parameters: readonly KaladaType[];
  readonly returns: KaladaType;
}

export interface KaladaFunctionParameter {
  readonly name: string;
  readonly type: KaladaType;
}

export interface FunctionExpression<R extends JsonValue> {
  readonly kind: "function";
  readonly parameters: readonly KaladaFunctionParameter[];
  readonly returns: KaladaType;
  readonly body: KaladaV1Expression<R>;
}

export interface CallExpression<R extends JsonValue> {
  readonly kind: "call";
  readonly callee: KaladaV1Expression<R>;
  readonly arguments: readonly KaladaV1Expression<R>[];
}

export interface NamedFunction<R extends JsonValue> {
  readonly name: string;
  readonly parameters: readonly KaladaFunctionParameter[];
  readonly returns: KaladaType;
  readonly body: KaladaV1Expression<R>;
}

export interface FunctionGroupExpression<R extends JsonValue> {
  readonly kind: "function-group";
  readonly functions: readonly NamedFunction<R>[];
  readonly body: KaladaV1Expression<R>;
}

export type KaladaCoreFunctionName = "map" | "filter" | "some" | "every";

export interface CoreFunctionExpression {
  readonly kind: "core-function";
  readonly name: KaladaCoreFunctionName;
}

export interface InstantExpression {
  readonly kind: "instant";
  readonly milliseconds: number;
}

export interface DurationExpression {
  readonly kind: "duration";
  readonly milliseconds: number;
}

export interface CurrentInstantExpression {
  readonly kind: "current-instant";
}

export interface TemporalArithmeticExpression<R extends JsonValue> {
  readonly kind: "temporal-arithmetic";
  readonly operator: "add" | "subtract";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface TemporalComparisonExpression<R extends JsonValue> {
  readonly kind: "temporal-comparison";
  readonly operator:
    | "equal"
    | "not-equal"
    | "less-than"
    | "less-than-or-equal"
    | "greater-than"
    | "greater-than-or-equal";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface FieldAccessExpression<R extends JsonValue> {
  readonly kind: "field-access";
  readonly target: KaladaV1Expression<R>;
  readonly field: string;
}

export interface OptionalFieldAccessExpression<R extends JsonValue> {
  readonly kind: "optional-field-access";
  readonly target: KaladaV1Expression<R>;
  readonly field: string;
}

export interface EqualityExpression<R extends JsonValue> {
  readonly kind: "equality";
  readonly operator: "equal" | "not-equal";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface OrderedComparisonExpression<R extends JsonValue> {
  readonly kind: "ordered-comparison";
  readonly domain: "number" | "string";
  readonly operator: "less-than" | "less-than-or-equal" | "greater-than" | "greater-than-or-equal";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface MembershipExpression<R extends JsonValue> {
  readonly kind: "membership";
  readonly needle: KaladaV1Expression<R>;
  readonly array: KaladaV1Expression<R>;
}

export interface NumericBinaryExpression<R extends JsonValue> {
  readonly kind: "numeric-binary";
  readonly operator: "add" | "subtract" | "multiply" | "divide" | "remainder";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface NumericUnaryExpression<R extends JsonValue> {
  readonly kind: "numeric-unary";
  readonly operator: "plus" | "negate";
  readonly operand: KaladaV1Expression<R>;
}

export interface BooleanNotExpression<R extends JsonValue> {
  readonly kind: "boolean-not";
  readonly operand: KaladaV1Expression<R>;
}

export interface BooleanLogicalExpression<R extends JsonValue> {
  readonly kind: "boolean-logical";
  readonly operator: "and" | "or";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface BooleanXorExpression<R extends JsonValue> {
  readonly kind: "boolean-xor";
  readonly left: KaladaV1Expression<R>;
  readonly right: KaladaV1Expression<R>;
}

export interface BindingExpression<R extends JsonValue> {
  readonly kind: "binding";
  readonly name: string;
  readonly value: KaladaV1Expression<R>;
  readonly body: KaladaV1Expression<R>;
}

export type OptionExpression<R extends JsonValue> =
  | { readonly kind: "option"; readonly variant: "none" }
  | { readonly kind: "option"; readonly variant: "some"; readonly value: KaladaV1Expression<R> };

export interface ResultExpression<R extends JsonValue> {
  readonly kind: "result";
  readonly variant: "ok" | "err";
  readonly value: KaladaV1Expression<R>;
}

export interface MatchExpression<R extends JsonValue> {
  readonly kind: "match";
  readonly type: "Option" | "Result";
  readonly value: KaladaV1Expression<R>;
  readonly arms: readonly MatchArm<R>[];
}

export interface MatchArm<R extends JsonValue> {
  readonly variant: "some" | "none" | "ok" | "err";
  readonly binding?: string;
  readonly body: KaladaV1Expression<R>;
}

export interface KaladaV1Program<R extends JsonValue = string> {
  readonly format: "kalada-program";
  readonly version: 1;
  readonly profile: "kalada-v1";
  readonly expression: KaladaV1Expression<R>;
}

export type KaladaV1DiagnosticCode =
  | "KALADA_INVALID_INPUT"
  | "KALADA_LIMIT_EXCEEDED"
  | "KALADA_INVALID_REFERENCE"
  | "KALADA_MATCH_MISSING_ARM"
  | "KALADA_MATCH_DUPLICATE_ARM"
  | "KALADA_MATCH_UNKNOWN_ARM"
  | "KALADA_MATCH_UNREACHABLE_ARM"
  | "KALADA_MATCH_TYPE_MISMATCH"
  | "KALADA_REFERENCE_ERROR"
  | "KALADA_REFERENCE_MISSING"
  | "KALADA_REFERENCE_DENIED"
  | "KALADA_ASYNC_UNSUPPORTED"
  | "KALADA_INVALID_RESULT"
  | "KALADA_EVALUATION_LIMIT"
  | "KALADA_INSTANT_REQUIRED"
  | "KALADA_TEMPORAL_TYPE_MISMATCH"
  | "KALADA_TEMPORAL_OVERFLOW"
  | "KALADA_CLOCK_ERROR"
  | "KALADA_INVALID_CLOCK"
  | "KALADA_DUPLICATE_BINDING"
  | "KALADA_INVALID_FUNCTION_TYPE"
  | "KALADA_CAPTURE_LIMIT"
  | "KALADA_NOT_CALLABLE"
  | "KALADA_FUNCTION_ARITY"
  | "KALADA_FUNCTION_TYPE_MISMATCH"
  | "KALADA_CLOSURE_LIMIT"
  | "KALADA_CALL_DEPTH_LIMIT"
  | "KALADA_CONTINUATION_LIMIT"
  | "KALADA_COLLECTION_TYPE_MISMATCH"
  | "KALADA_COLLECTION_LIMIT"
  | "KALADA_FUNCTION_ESCAPE"
  | "KALADA_FIELD_MISSING"
  | "KALADA_FIELD_TYPE_MISMATCH"
  | "KALADA_OPERATOR_TYPE"
  | "KALADA_OPERATOR_AMBIGUOUS"
  | "KALADA_NUMERIC_ZERO_DIVISOR"
  | "KALADA_NUMERIC_NON_FINITE";

export interface KaladaV1DiagnosticContextFrame {
  readonly kind: "function-call" | "core-call";
  readonly name: string | null;
  readonly path: readonly (string | number)[];
}

export interface KaladaV1Diagnostic {
  readonly code: KaladaV1DiagnosticCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly context?: readonly KaladaV1DiagnosticContextFrame[];
}

export type KaladaV1Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: KaladaV1Diagnostic };

export interface KaladaV1Limits {
  readonly maxAstDepth: number;
  readonly maxAstNodes: number;
  readonly maxValueDepth: number;
  readonly maxValueNodes: number;
  readonly maxStringLength: number;
  readonly maxReferenceLength: number;
  readonly maxEvaluationSteps: number;
}

export interface KaladaV1FunctionLimits {
  readonly maxFunctionParameters: number;
  readonly maxFunctionGroupSize: number;
  readonly maxCapturesPerClosure: number;
  readonly maxCapturedBindings: number;
  readonly maxClosures: number;
  readonly maxCallDepth: number;
  readonly maxContinuationFrames: number;
  readonly maxCollectionLength: number;
  readonly maxCollectionIterations: number;
}

export interface KaladaV1FunctionCapture {
  readonly path: readonly (string | number)[];
  readonly name: string | null;
  readonly captures: readonly string[];
}

export interface KaladaV1ReferenceCodec<R extends JsonValue> {
  readonly validate: (input: unknown) => input is R;
  readonly canonicalize?: (reference: R) => R;
}

export interface KaladaV1Options<R extends JsonValue> {
  readonly reference?: KaladaV1ReferenceCodec<R>;
  readonly limits?: Partial<KaladaV1Limits & KaladaV1FunctionLimits>;
}

export type KaladaV1Resolution =
  | { readonly found: true; readonly value: KaladaValue }
  | { readonly found: false; readonly reason?: "missing" | "denied" };

export type KaladaV1Resolver<R extends JsonValue> = (reference: R) => KaladaV1Resolution;

export interface KaladaV1EvaluationInputs {
  readonly instant?: InstantValue;
}

export type KaladaV1Clock = () => InstantValue;

export interface CompiledKaladaV1Program<R extends JsonValue> {
  readonly program: KaladaV1Program<R>;
  readonly dependencies: readonly R[];
  readonly functions: readonly KaladaV1FunctionCapture[];
  evaluate(
    resolve: KaladaV1Resolver<R>,
    inputs?: KaladaV1EvaluationInputs,
  ): KaladaV1Outcome<KaladaValue>;
  evaluateWithClock(
    resolve: KaladaV1Resolver<R>,
    clock: KaladaV1Clock,
  ): KaladaV1Outcome<KaladaValue>;
}

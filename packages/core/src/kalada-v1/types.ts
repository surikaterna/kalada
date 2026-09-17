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
  | TemporalComparisonExpression<R>;

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
  | "KALADA_INVALID_CLOCK";

export interface KaladaV1Diagnostic {
  readonly code: KaladaV1DiagnosticCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
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

export interface KaladaV1ReferenceCodec<R extends JsonValue> {
  readonly validate: (input: unknown) => input is R;
  readonly canonicalize?: (reference: R) => R;
}

export interface KaladaV1Options<R extends JsonValue> {
  readonly reference?: KaladaV1ReferenceCodec<R>;
  readonly limits?: Partial<KaladaV1Limits>;
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
  evaluate(
    resolve: KaladaV1Resolver<R>,
    inputs?: KaladaV1EvaluationInputs,
  ): KaladaV1Outcome<KaladaValue>;
  evaluateWithClock(
    resolve: KaladaV1Resolver<R>,
    clock: KaladaV1Clock,
  ): KaladaV1Outcome<KaladaValue>;
}

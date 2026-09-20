import type { JsonValue } from "./json.js";
import type {
  KaladaCoreFunctionName,
  KaladaFunctionParameter,
  KaladaType,
  KaladaV1Expression,
  KaladaV1Program,
  MatchArm,
  NamedFunction,
} from "./types.js";

const literal = <R extends JsonValue = string>(value: JsonValue): KaladaV1Expression<R> => ({
  kind: "literal",
  value,
});
const ref = <R extends JsonValue = string>(value: R): KaladaV1Expression<R> => ({
  kind: "ref",
  ref: value,
});
const fieldAccess = <R extends JsonValue>(
  target: KaladaV1Expression<R>,
  field: string,
): KaladaV1Expression<R> => ({ kind: "field-access", target, field });
const optionalFieldAccess = <R extends JsonValue>(
  target: KaladaV1Expression<R>,
  field: string,
): KaladaV1Expression<R> => ({ kind: "optional-field-access", target, field });
const equality = <R extends JsonValue>(
  operator: Extract<KaladaV1Expression<R>, { kind: "equality" }>["operator"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "equality", operator, left, right });
const orderedComparison = <R extends JsonValue>(
  domain: Extract<KaladaV1Expression<R>, { kind: "ordered-comparison" }>["domain"],
  operator: Extract<KaladaV1Expression<R>, { kind: "ordered-comparison" }>["operator"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "ordered-comparison", domain, operator, left, right });
const membership = <R extends JsonValue>(
  needle: KaladaV1Expression<R>,
  array: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "membership", needle, array });
const numericBinary = <R extends JsonValue>(
  operator: Extract<KaladaV1Expression<R>, { kind: "numeric-binary" }>["operator"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "numeric-binary", operator, left, right });
const numericUnary = <R extends JsonValue>(
  operator: Extract<KaladaV1Expression<R>, { kind: "numeric-unary" }>["operator"],
  operand: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "numeric-unary", operator, operand });
const booleanNot = <R extends JsonValue>(
  operand: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({
  kind: "boolean-not",
  operand,
});
const booleanLogical = <R extends JsonValue>(
  operator: Extract<KaladaV1Expression<R>, { kind: "boolean-logical" }>["operator"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "boolean-logical", operator, left, right });
const booleanXor = <R extends JsonValue>(
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "boolean-xor", left, right });
const binding = <R extends JsonValue>(
  name: string,
  value: KaladaV1Expression<R>,
  body: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "binding", name, value, body });
const some = <R extends JsonValue>(value: KaladaV1Expression<R>): KaladaV1Expression<R> => ({
  kind: "option",
  variant: "some",
  value,
});
const none = <R extends JsonValue = string>(): KaladaV1Expression<R> => ({
  kind: "option",
  variant: "none",
});
const ok = <R extends JsonValue>(value: KaladaV1Expression<R>): KaladaV1Expression<R> => ({
  kind: "result",
  variant: "ok",
  value,
});
const err = <R extends JsonValue>(value: KaladaV1Expression<R>): KaladaV1Expression<R> => ({
  kind: "result",
  variant: "err",
  value,
});
const arm = <R extends JsonValue>(
  variant: MatchArm<R>["variant"],
  body: KaladaV1Expression<R>,
  name?: string,
): MatchArm<R> => ({ variant, ...(name === undefined ? {} : { binding: name }), body });
const match = <R extends JsonValue>(
  type: "Option" | "Result",
  value: KaladaV1Expression<R>,
  arms: readonly MatchArm<R>[],
): KaladaV1Expression<R> => ({ kind: "match", type, value, arms });
const instant = <R extends JsonValue = string>(milliseconds: number): KaladaV1Expression<R> => ({
  kind: "instant",
  milliseconds,
});
const duration = <R extends JsonValue = string>(milliseconds: number): KaladaV1Expression<R> => ({
  kind: "duration",
  milliseconds,
});
const currentInstant = <R extends JsonValue = string>(): KaladaV1Expression<R> => ({
  kind: "current-instant",
});
const temporalArithmetic = <R extends JsonValue>(
  operator: "add" | "subtract",
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "temporal-arithmetic", operator, left, right });
const temporalComparison = <R extends JsonValue>(
  operator: Extract<KaladaV1Expression<R>, { kind: "temporal-comparison" }>["operator"],
  left: KaladaV1Expression<R>,
  right: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "temporal-comparison", operator, left, right });
const functionExpression = <R extends JsonValue>(
  parameters: readonly KaladaFunctionParameter[],
  returns: KaladaType,
  body: KaladaV1Expression<R>,
): KaladaV1Expression<R> =>
  Object.freeze({ kind: "function", parameters: Object.freeze([...parameters]), returns, body });
const call = <R extends JsonValue>(
  callee: KaladaV1Expression<R>,
  args: readonly KaladaV1Expression<R>[],
): KaladaV1Expression<R> =>
  Object.freeze({ kind: "call", callee, arguments: Object.freeze([...args]) });
const functionGroup = <R extends JsonValue>(
  functions: readonly NamedFunction<R>[],
  body: KaladaV1Expression<R>,
): KaladaV1Expression<R> =>
  Object.freeze({ kind: "function-group", functions: Object.freeze([...functions]), body });
const coreFunction = <R extends JsonValue = string>(
  name: KaladaCoreFunctionName,
): KaladaV1Expression<R> => Object.freeze({ kind: "core-function", name });
const parameter = (name: string, type: KaladaType): KaladaFunctionParameter =>
  Object.freeze({ name, type });
const namedFunction = <R extends JsonValue>(
  name: string,
  parameters: readonly KaladaFunctionParameter[],
  returns: KaladaType,
  body: KaladaV1Expression<R>,
): NamedFunction<R> =>
  Object.freeze({ name, parameters: Object.freeze([...parameters]), returns, body });
const primitiveType = (name: Extract<KaladaType, { kind: "primitive-type" }>["name"]): KaladaType =>
  Object.freeze({ kind: "primitive-type", name });
const optionType = (value: KaladaType): KaladaType => Object.freeze({ kind: "option-type", value });
const resultType = (ok: KaladaType, error: KaladaType): KaladaType =>
  Object.freeze({
    kind: "result-type",
    ok,
    error,
  });
const arrayType = (element: KaladaType): KaladaType =>
  Object.freeze({ kind: "array-type", element });
const functionType = (parameters: readonly KaladaType[], returns: KaladaType): KaladaType =>
  Object.freeze({ kind: "function-type", parameters: Object.freeze([...parameters]), returns });

export const KaladaV1 = Object.freeze({
  literal,
  ref,
  fieldAccess,
  optionalFieldAccess,
  equality,
  orderedComparison,
  membership,
  numericBinary,
  numericUnary,
  booleanNot,
  booleanLogical,
  booleanXor,
  binding,
  Option: Object.freeze({ some, none }),
  Result: Object.freeze({ ok, err }),
  arm,
  match,
  instant,
  duration,
  currentInstant,
  temporalArithmetic,
  temporalComparison,
  function: functionExpression,
  call,
  functionGroup,
  coreFunction,
  parameter,
  namedFunction,
  Type: Object.freeze({
    primitive: primitiveType,
    option: optionType,
    result: resultType,
    array: arrayType,
    function: functionType,
  }),
  program<R extends JsonValue = string>(expression: KaladaV1Expression<R>): KaladaV1Program<R> {
    return { format: "kalada-program", version: 1, profile: "kalada-v1", expression };
  },
});

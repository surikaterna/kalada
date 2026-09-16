export { canonicalizeExpression } from "./canonicalize.js";
export { type CompileExpressionOptions, compileExpression } from "./compile.js";
export { extractExpressionDependencies } from "./dependencies.js";
export {
  type ExpressionJsonSchema,
  generateExpressionJsonSchema,
  getStandardExpressionJsonSchema,
} from "./json-schema.js";
export { DEFAULT_EXPRESSION_LIMITS } from "./limits.js";
export {
  type ExpressionOperator,
  type ExpressionOperatorDefinition,
  type ExpressionOperatorFn,
  ExpressionProfile,
  ExpressionProfileBuilder,
  type ExpressionValueType,
  MAX_EXPRESSION_OPERATOR_ARGS,
} from "./profile.js";
export { standardV1 } from "./standard-profile.js";
export type {
  CanonicalizeExpressionOptions,
  CompiledExpression,
  ExpressionDiagnostic,
  ExpressionDiagnosticCode,
  ExpressionLimits,
  ExpressionPath,
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ReferenceCodec,
  ReferenceResolution,
  ReferenceResolver,
  Result,
  ValueExpression,
} from "./types.js";

import { canonicalizeExpression } from "./canonicalize.js";
import { collectExpressionDependencies } from "./dependencies.js";
import { evaluateCompiled } from "./evaluate.js";
import { resolveLimits } from "./limits.js";
import {
  type ExpressionOperator,
  ExpressionProfile,
  MAX_EXPRESSION_OPERATOR_ARGS,
} from "./profile.js";
import { failure, success } from "./result.js";
import type {
  CanonicalizeExpressionOptions,
  CompiledExpression,
  ExpressionLimits,
  ExpressionPath,
  JsonValue,
  Result,
  ValueExpression,
} from "./types.js";

export interface CompileExpressionOptions<R extends JsonValue>
  extends CanonicalizeExpressionOptions<R> {
  readonly profile: ExpressionProfile;
}

/** Compile and validate a complete expression against one structurally immutable profile. */
export function compileExpression<R extends JsonValue = string>(
  input: unknown,
  options: CompileExpressionOptions<R>,
): Result<CompiledExpression<R>> {
  if (!options || !(options.profile instanceof ExpressionProfile))
    return failure("EXPRESSION_INVALID_INPUT", []);
  const canonical = canonicalizeExpression<R>(input, options);
  if (!canonical.ok) return canonical;
  const operators = new Map<ValueExpression<R>, ExpressionOperator>();
  const validation = validateOperators(canonical.value, options.profile, [], operators);
  if (!validation.ok) return validation;
  let limits: ExpressionLimits;
  try {
    limits = resolveLimits(options.limits);
  } catch {
    return failure("EXPRESSION_LIMIT_EXCEEDED", []);
  }
  const expression = canonical.value;
  const dependencies = collectExpressionDependencies(expression);
  const compiled: CompiledExpression<R> = {
    expression,
    dependencies,
    evaluate: (resolve) => evaluateCompiled(expression, resolve, operators, limits),
  };
  return success(Object.freeze(compiled));
}

function validateOperators<R extends JsonValue>(
  node: ValueExpression<R>,
  profile: ExpressionProfile,
  path: ExpressionPath,
  output: Map<ValueExpression<R>, ExpressionOperator>,
): Result<undefined> {
  if (node.kind !== "op") return success(undefined);
  const operator = profile.get(node.op);
  if (!operator) return failure("EXPRESSION_UNKNOWN_OPERATOR", [...path, "op"]);
  if (!validArity(operator, node.args.length))
    return failure("EXPRESSION_INVALID_ARITY", [...path, "args"]);
  output.set(node, operator);
  for (let index = 0; index < node.args.length; index += 1) {
    const result = validateOperators(node.args[index]!, profile, [...path, "args", index], output);
    if (!result.ok) return result;
  }
  return success(undefined);
}

function validArity(operator: ExpressionOperator, length: number): boolean {
  if (operator.arity !== undefined) return length === operator.arity;
  return (
    length >= (operator.minArgs ?? 0) &&
    length <= (operator.maxArgs ?? MAX_EXPRESSION_OPERATOR_ARGS)
  );
}

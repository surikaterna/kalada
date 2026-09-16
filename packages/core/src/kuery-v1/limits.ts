import { MAX_EXPRESSION_OPERATOR_ARGS } from "./profile.js";
import type { ExpressionLimits } from "./types.js";

export const DEFAULT_EXPRESSION_LIMITS: ExpressionLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxArgs: MAX_EXPRESSION_OPERATOR_ARGS,
  maxStringLength: 10_000,
  maxReferenceLength: 1_000,
  maxEvaluationSteps: 10_000,
});

const MAX_EXPRESSION_LIMITS: ExpressionLimits = Object.freeze({
  maxDepth: 256,
  maxNodes: 100_000,
  maxArgs: MAX_EXPRESSION_OPERATOR_ARGS,
  maxStringLength: 1_000_000,
  maxReferenceLength: 100_000,
  maxEvaluationSteps: 100_000,
});

export function resolveLimits(input?: Partial<ExpressionLimits>): ExpressionLimits {
  const limits = { ...DEFAULT_EXPRESSION_LIMITS, ...input };
  for (const key of Object.keys(limits) as (keyof ExpressionLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EXPRESSION_LIMITS[key]) {
      throw new TypeError("Expression limits must be positive safe integers.");
    }
  }
  return Object.freeze(limits);
}

import type { KaladaV1Limits } from "./types.js";

export const DEFAULT_KALADA_V1_LIMITS: KaladaV1Limits = Object.freeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxStringLength: 10_000,
  maxReferenceLength: 1_000,
  maxEvaluationSteps: 10_000,
});

const MAXIMUM: KaladaV1Limits = Object.freeze({
  maxDepth: 256,
  maxNodes: 100_000,
  maxStringLength: 1_000_000,
  maxReferenceLength: 100_000,
  maxEvaluationSteps: 100_000,
});

export function resolveLimits(input?: Partial<KaladaV1Limits>): KaladaV1Limits {
  const limits = { ...DEFAULT_KALADA_V1_LIMITS, ...input };
  for (const key of Object.keys(limits) as (keyof KaladaV1Limits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM[key])
      throw new RangeError("limit");
  }
  return Object.freeze(limits);
}

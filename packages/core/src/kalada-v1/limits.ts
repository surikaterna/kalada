import type { KaladaV1FunctionLimits, KaladaV1Limits } from "./types.js";

export type ResolvedKaladaV1Limits = KaladaV1Limits & KaladaV1FunctionLimits;

export const DEFAULT_KALADA_V1_LIMITS: KaladaV1Limits = Object.freeze({
  maxAstDepth: 64,
  maxAstNodes: 10_000,
  maxValueDepth: 64,
  maxValueNodes: 10_000,
  maxStringLength: 10_000,
  maxReferenceLength: 1_000,
  maxEvaluationSteps: 10_000,
});

export const DEFAULT_KALADA_V1_FUNCTION_LIMITS: KaladaV1FunctionLimits = Object.freeze({
  maxFunctionParameters: 32,
  maxFunctionGroupSize: 64,
  maxCapturesPerClosure: 64,
  maxCapturedBindings: 1_000,
  maxClosures: 1_000,
  maxCallDepth: 256,
  maxContinuationFrames: 1_000,
  maxCollectionLength: 10_000,
  maxCollectionIterations: 10_000,
});

const MAXIMUM: ResolvedKaladaV1Limits = Object.freeze({
  maxAstDepth: 256,
  maxAstNodes: 100_000,
  maxValueDepth: 256,
  maxValueNodes: 100_000,
  maxStringLength: 1_000_000,
  maxReferenceLength: 100_000,
  maxEvaluationSteps: 100_000,
  maxFunctionParameters: 256,
  maxFunctionGroupSize: 1_024,
  maxCapturesPerClosure: 256,
  maxCapturedBindings: 100_000,
  maxClosures: 100_000,
  maxCallDepth: 4_096,
  maxContinuationFrames: 100_000,
  maxCollectionLength: 100_000,
  maxCollectionIterations: 100_000,
});

export function resolveLimits(input?: Partial<ResolvedKaladaV1Limits>): ResolvedKaladaV1Limits {
  const limits = { ...DEFAULT_KALADA_V1_LIMITS, ...DEFAULT_KALADA_V1_FUNCTION_LIMITS, ...input };
  for (const key of Object.keys(limits) as (keyof ResolvedKaladaV1Limits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM[key])
      throw new RangeError("limit");
  }
  return Object.freeze(limits);
}

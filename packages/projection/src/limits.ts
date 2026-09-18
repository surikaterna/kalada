import type { ProjectionV1Limits } from "./types.js";

export const DEFAULT_PROJECTION_V1_LIMITS: Readonly<ProjectionV1Limits> = Object.freeze({
  maxProjectionDepth: 64,
  maxProjectionNodes: 10_000,
  maxObjectEntries: 10_000,
  maxArrayItems: 10_000,
  maxNameLength: 128,
  maxKeyLength: 1_000,
  maxExpressionInvocations: 10_000,
  maxCollectionLength: 10_000,
  maxCollectionIterations: 10_000,
  maxOutputDepth: 64,
  maxOutputNodes: 10_000,
  maxOutputBytes: 1_048_576,
});

export const MAXIMUM_PROJECTION_V1_LIMITS: Readonly<ProjectionV1Limits> = Object.freeze({
  maxProjectionDepth: 256,
  maxProjectionNodes: 100_000,
  maxObjectEntries: 100_000,
  maxArrayItems: 100_000,
  maxNameLength: 1_024,
  maxKeyLength: 10_000,
  maxExpressionInvocations: 100_000,
  maxCollectionLength: 100_000,
  maxCollectionIterations: 100_000,
  maxOutputDepth: 256,
  maxOutputNodes: 100_000,
  maxOutputBytes: 16_777_216,
});

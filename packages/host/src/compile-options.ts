import type { KaladaV1FunctionLimits, KaladaV1Limits } from "@kalada/core";
import { readOwnDataRecord } from "./serializable.js";

type CoreLimits = KaladaV1Limits & KaladaV1FunctionLimits;

export const HOST_COMPILE_OPTIONS_CONTRACT = "kalada-host-compile-options-v1";

export interface NormalizedCompileOptions {
  readonly profile: string;
  readonly limits: Readonly<Partial<CoreLimits>>;
}

const MAXIMUM: Readonly<Record<keyof CoreLimits, number>> = Object.freeze({
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

export function normalizeCompileOptions(input: unknown): NormalizedCompileOptions | null {
  if (input === undefined) return frozenOptions("default", Object.freeze({}));
  const inspected = readOwnDataRecord(input, 2);
  if (!inspected.ok || hasUnknownKeys(inspected.value, ["profile", "limits"])) return null;
  const profile = inspected.value.profile ?? "default";
  if (typeof profile !== "string" || profile.length === 0 || profile.length > 1_000) return null;
  const limits = normalizeLimits(inspected.value.limits);
  return limits ? frozenOptions(profile, limits) : null;
}

function normalizeLimits(input: unknown): Readonly<Partial<CoreLimits>> | null {
  if (input === undefined) return Object.freeze({});
  const inspected = readOwnDataRecord(input, Object.keys(MAXIMUM).length);
  if (!inspected.ok) return null;
  const output: Record<string, number> = Object.create(null);
  for (const [key, value] of Object.entries(inspected.value)) {
    if (!Object.hasOwn(MAXIMUM, key) || !validLimit(key as keyof CoreLimits, value)) return null;
    output[key] = value as number;
  }
  return Object.freeze(output) as Readonly<Partial<CoreLimits>>;
}

function validLimit(key: keyof CoreLimits, value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAXIMUM[key];
}

function hasUnknownKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).some((key) => !allowed.includes(key));
}

function frozenOptions(
  profile: string,
  limits: Readonly<Partial<CoreLimits>>,
): NormalizedCompileOptions {
  return Object.freeze({ profile, limits });
}

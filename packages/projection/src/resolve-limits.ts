import { ProjectionFailure } from "./diagnostics.js";
import { inspectRecord } from "./inspect.js";
import { DEFAULT_PROJECTION_V1_LIMITS, MAXIMUM_PROJECTION_V1_LIMITS } from "./limits.js";
import type { ProjectionV1Limits } from "./types.js";

const NAMES = Object.freeze(
  Object.keys(DEFAULT_PROJECTION_V1_LIMITS) as (keyof ProjectionV1Limits)[],
);

export function resolveProjectionLimits(input: unknown): Readonly<ProjectionV1Limits> {
  if (input === undefined) return DEFAULT_PROJECTION_V1_LIMITS;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ProjectionFailure("PROJECTION_INVALID_INPUT", []);
  }
  const raw = inspectRecord(input, ["limits"], [], NAMES, true);
  const resolved = { ...DEFAULT_PROJECTION_V1_LIMITS };
  for (const name of NAMES) {
    if (!(name in raw)) continue;
    const value = raw[name];
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
      throw new ProjectionFailure("PROJECTION_INVALID_INPUT", ["limits", name]);
    }
    if ((value as number) > MAXIMUM_PROJECTION_V1_LIMITS[name]) {
      throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", ["limits", name]);
    }
    resolved[name] = value as number;
  }
  return Object.freeze(resolved);
}

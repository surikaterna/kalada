import type { SchemanAnalysisLimits } from "./types.js";

export const DEFAULT_SCHEMAN_ANALYSIS_LIMITS: SchemanAnalysisLimits = Object.freeze({
  maxNodes: 2_048,
  maxEdges: 8_192,
  maxTypeDepth: 32,
});

export function resolveAnalysisLimits(
  requested: Partial<SchemanAnalysisLimits> | undefined,
): SchemanAnalysisLimits {
  return Object.freeze({
    maxNodes: bounded(requested?.maxNodes, DEFAULT_SCHEMAN_ANALYSIS_LIMITS.maxNodes),
    maxEdges: bounded(requested?.maxEdges, DEFAULT_SCHEMAN_ANALYSIS_LIMITS.maxEdges),
    maxTypeDepth: bounded(requested?.maxTypeDepth, DEFAULT_SCHEMAN_ANALYSIS_LIMITS.maxTypeDepth),
  });
}

function bounded(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return maximum;
  return Math.min(value, maximum);
}

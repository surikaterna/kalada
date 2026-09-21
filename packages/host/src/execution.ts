import { compileExpression, parseExpression } from "./compile-expression.js";
import type { ManualProvider } from "./contracts.js";
import type {
  EvaluateExpressionResult,
  HostPrepareOptions,
  PrepareExpressionResult,
} from "./execution-contracts.js";
import { executionDiagnostic } from "./execution-diagnostics.js";
import { linkExpression } from "./link-expression.js";
import { describeEnvironment } from "./manual-provider.js";
import { readOwnDataRecord } from "./serializable.js";

export function prepareExpression(
  source: string,
  provider: ManualProvider,
  options?: HostPrepareOptions,
): PrepareExpressionResult {
  const described = describeEnvironment(provider);
  if (!described.ok) return described;
  const normalized = normalizeOptions(options);
  if (!normalized) {
    return Object.freeze({
      ok: false,
      diagnostics: Object.freeze([executionDiagnostic("HOST_COMPILE_INVALID_OPTIONS", "compile")]),
    });
  }
  const parsed = parseExpression(source, normalized.parse);
  if (!parsed.ok) return parsed;
  const compiled = compileExpression(
    parsed.value,
    described.environment.compileProjection,
    normalized.compile,
  );
  if (!compiled.ok) return compiled;
  return linkExpression(compiled.value, described.environment, described.capabilitySnapshot);
}

function normalizeOptions(options: unknown): HostPrepareOptions | null {
  if (options === undefined) return Object.freeze({});
  const inspected = readOwnDataRecord(options, 2);
  if (!inspected.ok) return null;
  return Object.freeze({
    ...(inspected.value.parse === undefined ? {} : { parse: inspected.value.parse as never }),
    ...(inspected.value.compile === undefined ? {} : { compile: inspected.value.compile as never }),
  });
}

export function evaluateExpression(
  source: string,
  provider: ManualProvider,
  values: unknown,
  options?: HostPrepareOptions,
): EvaluateExpressionResult {
  const prepared = prepareExpression(source, provider, options);
  return prepared.ok ? prepared.value.evaluate(values) : prepared;
}

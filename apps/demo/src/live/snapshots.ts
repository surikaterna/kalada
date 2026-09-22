import type { PreparedExpression } from "@kalada/host";
import type { DemoEnvironment } from "../schema/environment.js";
import type { DataValidation } from "../schema/validator.js";
import type { FileResult, RuntimeSnapshot, RuntimeState } from "./runtime.js";

export function failedEnvironment() {
  return {
    ok: false as const,
    diagnostics: [
      {
        code: "HOST_ENVIRONMENT_INVALID_PROVIDER" as const,
        phase: "environment" as const,
        message: "Schema environment is unavailable",
      },
    ],
  };
}

export function emptyFile(name: string, code = "SOURCE_LOADING"): FileResult {
  return Object.freeze({
    name,
    state: "loading",
    diagnostics: Object.freeze([{ code }]),
    dependencies: Object.freeze([]),
    timing: Object.freeze({ prepare: 0, evaluate: 0 }),
  });
}

export function failureFile(
  name: string,
  diagnostics: readonly unknown[],
  prepare: number,
): FileResult {
  return Object.freeze({
    name,
    state: "invalid",
    diagnostics,
    dependencies: Object.freeze([]),
    timing: Object.freeze({ prepare, evaluate: 0 }),
  });
}

export function waitingFile(
  name: string,
  prepared: PreparedExpression,
  prepare: number,
): FileResult {
  return Object.freeze({
    name,
    state: "loading",
    diagnostics: Object.freeze([]),
    resultType: prepared.compiled.resultType,
    dependencies: prepared.compiled.dependencies,
    timing: Object.freeze({ prepare, evaluate: 0 }),
    compiled: prepared.compiled,
    prepared,
  });
}

export function resultFile(
  name: string,
  prepared: PreparedExpression,
  outcome: ReturnType<PreparedExpression["evaluate"]>,
  prepare: number,
  evaluate: number,
): FileResult {
  return Object.freeze({
    name,
    state: outcome.ok ? "ready" : "invalid",
    ...(outcome.ok ? { output: outcome.value } : {}),
    diagnostics: outcome.ok ? Object.freeze([]) : outcome.diagnostics,
    resultType: prepared.compiled.resultType,
    dependencies: prepared.compiled.dependencies,
    timing: Object.freeze({ prepare, evaluate }),
    compiled: prepared.compiled,
    prepared,
  });
}

export function freezeSnapshot(
  state: RuntimeState,
  code: string,
  environment: DemoEnvironment | undefined,
  data: unknown,
  validation: DataValidation | undefined,
  files: Map<string, FileResult>,
): RuntimeSnapshot {
  return Object.freeze({
    state,
    code,
    ...(environment ? { environment } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(validation ? { dataValidation: validation } : {}),
    files: new Map(files),
  });
}

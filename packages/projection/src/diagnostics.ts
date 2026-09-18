import type { KaladaV1Diagnostic } from "@kalada/core";
import type {
  ProjectionDiagnostic,
  ProjectionDiagnosticCode,
  ProjectionOutcome,
  ProjectionPath,
} from "./types.js";

export const PROJECTION_V1_DIAGNOSTIC_MESSAGES: Readonly<Record<ProjectionDiagnosticCode, string>> =
  Object.freeze({
    PROJECTION_INVALID_INPUT: "Projection input is invalid.",
    PROJECTION_LIMIT_EXCEEDED: "Projection limit exceeded.",
    PROJECTION_DUPLICATE_KEY: "Projection object key is duplicated.",
    PROJECTION_UNSAFE_KEY: "Projection object key is unsafe.",
    PROJECTION_CONDITION_TYPE: "Projection condition must evaluate to a boolean.",
    PROJECTION_COLLECTION_TYPE: "Projection map collection must evaluate to a JSON array.",
    PROJECTION_VALUE_TYPE:
      "Projection value must evaluate to JSON, Option.some(JSON), or Option.none.",
    PROJECTION_OUTPUT_LIMIT: "Projection output limit exceeded.",
    PROJECTION_CORE_ERROR: "Kalada expression evaluation failed.",
    PROJECTION_CLOCK_ERROR: "Projection clock failed.",
  });

export class ProjectionFailure extends Error {
  readonly code: ProjectionDiagnosticCode;
  readonly path: ProjectionPath;
  override readonly cause?: KaladaV1Diagnostic;

  constructor(code: ProjectionDiagnosticCode, path: ProjectionPath, cause?: KaladaV1Diagnostic) {
    super(code);
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}

export function projectionFailure<T>(
  code: ProjectionDiagnosticCode,
  path: ProjectionPath,
  cause?: KaladaV1Diagnostic,
): ProjectionOutcome<T> {
  const diagnostic: ProjectionDiagnostic = Object.freeze({
    code,
    path: Object.freeze([...path]),
    message: PROJECTION_V1_DIAGNOSTIC_MESSAGES[code],
    ...(cause === undefined ? {} : { cause: freezeCoreDiagnostic(cause) }),
  });
  return Object.freeze({ ok: false, diagnostic });
}

export function projectionSuccess<T>(value: T): ProjectionOutcome<T> {
  return Object.freeze({ ok: true, value });
}

function freezeCoreDiagnostic(cause: KaladaV1Diagnostic): KaladaV1Diagnostic {
  const context = cause.context?.map((frame) =>
    Object.freeze({ kind: frame.kind, name: frame.name, path: Object.freeze([...frame.path]) }),
  );
  return Object.freeze({
    code: cause.code,
    path: Object.freeze([...cause.path]),
    message: cause.message,
    ...(context === undefined ? {} : { context: Object.freeze(context) }),
  });
}

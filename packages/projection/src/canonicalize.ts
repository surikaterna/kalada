import { canonicalProjection } from "./canonical-machine.js";
import { ProjectionFailure, projectionFailure, projectionSuccess } from "./diagnostics.js";
import type { ProjectionOutcome, ProjectionProgram, ProjectionV1Options } from "./types.js";

export function canonicalizeProjectionV1(
  input: unknown,
  options: ProjectionV1Options = {},
): ProjectionOutcome<ProjectionProgram> {
  try {
    return projectionSuccess(canonicalProjection(input, options).projection);
  } catch (error) {
    const failure =
      error instanceof ProjectionFailure
        ? error
        : new ProjectionFailure("PROJECTION_INVALID_INPUT", []);
    return projectionFailure(failure.code, failure.path, failure.cause);
  }
}

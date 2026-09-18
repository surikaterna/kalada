import { canonicalProjection } from "./canonical-machine.js";
import { ProjectionFailure, projectionFailure, projectionSuccess } from "./diagnostics.js";
import type { CompiledProjection, ProjectionOutcome, ProjectionV1Options } from "./types.js";

export function compileProjectionV1(
  input: unknown,
  options: ProjectionV1Options = {},
): ProjectionOutcome<CompiledProjection> {
  try {
    const result = canonicalProjection(input, options);
    return projectionSuccess(
      Object.freeze({ projection: result.projection, dependencies: result.dependencies }),
    );
  } catch (error) {
    const failure =
      error instanceof ProjectionFailure
        ? error
        : new ProjectionFailure("PROJECTION_INVALID_INPUT", []);
    return projectionFailure(failure.code, failure.path, failure.cause);
  }
}

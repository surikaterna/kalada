import { codePointLengthAbove } from "./canonical-object.js";
import { ProjectionFailure } from "./diagnostics.js";
import { invalid } from "./inspect.js";
import type { ProjectionPath } from "./types.js";

export function exact(
  raw: Record<string, unknown>,
  path: ProjectionPath,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) invalid(path);
  for (const key of required) if (!(key in raw)) invalid([...path, key]);
}

export function bindingName(input: unknown, path: ProjectionPath, maximum: number): string {
  if (typeof input !== "string" || input.length === 0) invalid(path);
  if (codePointLengthAbove(input, maximum)) {
    throw new ProjectionFailure("PROJECTION_LIMIT_EXCEEDED", path);
  }
  return input;
}

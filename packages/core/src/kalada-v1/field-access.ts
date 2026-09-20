import { fail } from "./evaluation-state.js";
import type { JsonValue } from "./json.js";
import { isCallable, type RuntimeValue } from "./runtime-values.js";
import { isDuration, isInstant } from "./temporal.js";
import { isOption, isResult, Option } from "./values.js";

type Path = readonly (string | number)[];

export function applyFieldAccess(
  kind: "field-access" | "optional-field-access",
  input: RuntimeValue,
  field: string,
  path: Path,
): RuntimeValue {
  const optional = kind === "optional-field-access";
  let target = input;
  if (optional && isOption(target)) {
    if (target.variant === "none") return target;
    target = target.value;
  }
  if (optional && target === null) return Option.some(null);
  if (!isJsonObject(target)) fail("KALADA_FIELD_TYPE_MISMATCH", [...path, "target"]);
  const descriptor = ownDescriptor(target, field, path);
  if (!descriptor) {
    if (optional) return Option.none();
    fail("KALADA_FIELD_MISSING", [...path, "field"]);
  }
  if (!("value" in descriptor) || !descriptor.enumerable) {
    fail("KALADA_FIELD_TYPE_MISMATCH", [...path, "target"]);
  }
  const value = descriptor.value as JsonValue;
  return optional ? Option.some(value) : value;
}

function isJsonObject(value: RuntimeValue): value is { readonly [key: string]: JsonValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isOption(value) &&
    !isResult(value) &&
    !isInstant(value) &&
    !isDuration(value) &&
    !isCallable(value)
  );
}

function ownDescriptor(target: object, field: string, path: Path): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(target, field);
  } catch {
    return fail("KALADA_FIELD_TYPE_MISMATCH", [...path, "target"]);
  }
}

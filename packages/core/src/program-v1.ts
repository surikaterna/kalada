import { canonicalizeExpression } from "./kuery-v1/canonicalize.js";
import { failure, success } from "./kuery-v1/result.js";
import type {
  CanonicalizeExpressionOptions,
  ExpressionDiagnostic,
  JsonValue,
  Result,
  ValueExpression,
} from "./kuery-v1/types.js";

export interface KaladaProgramV1<R extends JsonValue = string> {
  readonly format: "kalada-program";
  readonly version: 1;
  readonly profile: "standard-v1";
  readonly expression: ValueExpression<R>;
}

export type KaladaProgramV1Options<R extends JsonValue = string> = CanonicalizeExpressionOptions<R>;
export type KaladaProgramV1Result<R extends JsonValue = string> = Result<KaladaProgramV1<R>>;
export type KueryExpressionV1<R extends JsonValue = string> = ValueExpression<R>;
export type KaladaProgramDiagnostic = ExpressionDiagnostic;

const PROGRAM_KEYS = new Set(["format", "version", "profile", "expression"]);

export function canonicalizeKaladaProgramV1<R extends JsonValue = string>(
  input: unknown,
  options: KaladaProgramV1Options<R> = {},
): KaladaProgramV1Result<R> {
  const fields = readProgramFields(input);
  if (!fields.ok) return fields;
  if (
    fields.value.format !== "kalada-program" ||
    fields.value.version !== 1 ||
    fields.value.profile !== "standard-v1"
  ) {
    return failure("EXPRESSION_INVALID_INPUT", []);
  }
  const expression = canonicalizeExpression<R>(fields.value.expression, options);
  if (!expression.ok) return prefixExpressionPath(expression.diagnostic);
  return success(
    Object.freeze({
      format: "kalada-program",
      version: 1,
      profile: "standard-v1",
      expression: expression.value,
    }),
  );
}

export function fromKueryExpression<R extends JsonValue = string>(
  expression: unknown,
  options: KaladaProgramV1Options<R> = {},
): KaladaProgramV1Result<R> {
  return canonicalizeKaladaProgramV1(
    { format: "kalada-program", version: 1, profile: "standard-v1", expression },
    options,
  );
}

export function toKueryExpression<R extends JsonValue = string>(
  program: unknown,
  options: KaladaProgramV1Options<R> = {},
): Result<ValueExpression<R>> {
  const canonical = canonicalizeKaladaProgramV1<R>(program, options);
  return canonical.ok ? success(canonical.value.expression) : canonical;
}

function readProgramFields(input: unknown): Result<Readonly<Record<string, unknown>>> {
  if (!isPlainObject(input)) return failure("EXPRESSION_INVALID_INPUT", []);
  try {
    const keys = Reflect.ownKeys(input);
    if (keys.length !== PROGRAM_KEYS.size) return failure("EXPRESSION_INVALID_INPUT", []);
    const fields: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || !PROGRAM_KEYS.has(key)) {
        return failure("EXPRESSION_INVALID_INPUT", []);
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return failure("EXPRESSION_INVALID_INPUT", [key]);
      }
      fields[key] = descriptor.value;
    }
    return success(fields);
  } catch {
    return failure("EXPRESSION_INVALID_INPUT", []);
  }
}

function isPlainObject(input: unknown): input is object {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function prefixExpressionPath<R extends JsonValue>(
  diagnostic: ExpressionDiagnostic,
): KaladaProgramV1Result<R> {
  return failure(diagnostic.code, ["expression", ...diagnostic.path]);
}

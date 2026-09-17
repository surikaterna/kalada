import { rejectCallbackPromise } from "../kuery-v1/callback-promise.js";
import { KaladaFailure } from "./diagnostics.js";
import type { Path } from "./evaluation-frames.js";
import { cloneJson, dataValue, type JsonValue } from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import { isDuration, isInstant } from "./temporal.js";
import type { KaladaV1Resolver } from "./types.js";
import { isOption, isResult, type KaladaValue, validateKaladaValueLimits } from "./values.js";

export function resolveReference<R extends JsonValue>(
  reference: R,
  path: Path,
  resolve: KaladaV1Resolver<R>,
  limits: ResolvedKaladaV1Limits,
): KaladaValue {
  let input: unknown;
  try {
    input = resolve(reference);
  } catch {
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  }
  if (rejectCallbackPromise(input)) throw new KaladaFailure("KALADA_ASYNC_UNSUPPORTED", path);
  return parseResolution(input, path, limits);
}

function parseResolution(input: unknown, path: Path, limits: ResolvedKaladaV1Limits): KaladaValue {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  }
  const keys = safeKeys(input, path);
  const found = safeData(input, "found", path);
  if (typeof found !== "boolean") throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
  if (!found) return missingResolution(input, keys, path);
  if (keys.length !== 2 || !keys.includes("value")) failReference(path);
  return safeValue(safeData(input, "value", path), path, limits);
}

function missingResolution(input: object, keys: readonly PropertyKey[], path: Path): never {
  if (keys.length === 1) throw new KaladaFailure("KALADA_REFERENCE_MISSING", path);
  if (keys.length !== 2 || !keys.includes("reason")) failReference(path);
  const reason = safeData(input, "reason", path);
  if (reason === undefined || reason === "missing") {
    throw new KaladaFailure("KALADA_REFERENCE_MISSING", path);
  }
  if (reason === "denied") throw new KaladaFailure("KALADA_REFERENCE_DENIED", path);
  return failReference(path);
}

function safeValue(input: unknown, path: Path, limits: ResolvedKaladaV1Limits): KaladaValue {
  try {
    if (isOption(input) || isResult(input) || isInstant(input) || isDuration(input)) {
      validateKaladaValueLimits(input, {
        maxDepth: limits.maxValueDepth,
        maxNodes: limits.maxValueNodes,
        maxStringLength: limits.maxStringLength,
      });
      return input;
    }
    return cloneJson(input, {
      maxDepth: limits.maxValueDepth,
      maxNodes: limits.maxValueNodes,
      maxStringLength: limits.maxStringLength,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new KaladaFailure("KALADA_LIMIT_EXCEEDED", path);
    throw new KaladaFailure("KALADA_INVALID_RESULT", path);
  }
}

function safeKeys(input: object, path: Path): PropertyKey[] {
  try {
    return Reflect.ownKeys(input);
  } catch {
    return failReference(path);
  }
}

function safeData(input: object, key: string, path: Path): unknown {
  try {
    return dataValue(input, key);
  } catch {
    return failReference(path);
  }
}

function failReference(path: Path): never {
  throw new KaladaFailure("KALADA_REFERENCE_ERROR", path);
}

import type { JsonValue, KaladaV1Options } from "@kalada/core";
import { hasOnlyKeys, ownDataProperty } from "./limits.js";
import type { KaladaLowerOptions, KaladaSyntaxLimits } from "./public-types.js";
import { readStaticType, type StaticType } from "./static-types.js";

export interface SafeBinding<R extends JsonValue> {
  readonly reference: R;
  readonly type: StaticType;
}

export interface LowerConfiguration<R extends JsonValue> {
  readonly environment: ReadonlyMap<string, SafeBinding<R>> | null;
  readonly coreOptions: KaladaV1Options<R>;
}

export function readLowerConfiguration<R extends JsonValue>(
  options: KaladaLowerOptions<R> | undefined,
  limits: KaladaSyntaxLimits,
): LowerConfiguration<R> | null {
  if (options === undefined) return { environment: null, coreOptions: {} };
  if (!hasOnlyKeys(options, new Set(["references", "coreOptions"]))) return null;
  const referencesProperty = ownDataProperty(options, "references");
  const coreOptionsProperty = ownDataProperty(options, "coreOptions");
  if (!referencesProperty.ok || !coreOptionsProperty.ok) return null;
  const references = referencesProperty.value;
  const coreOptions = coreOptionsProperty.value;
  if (coreOptionsProperty.present && (typeof coreOptions !== "object" || coreOptions === null))
    return null;
  const environment = referencesProperty.present ? readEnvironment<R>(references, limits) : null;
  if (referencesProperty.present && environment === null) return null;
  return { environment, coreOptions: (coreOptions ?? {}) as KaladaV1Options<R> };
}

function readEnvironment<R extends JsonValue>(
  input: unknown,
  limits: KaladaSyntaxLimits,
): ReadonlyMap<string, SafeBinding<R>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const output = new Map<string, SafeBinding<R>>();
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) return null;
      const binding = readBinding<R>(descriptor.value, limits);
      if (binding === null) return null;
      output.set(key, binding);
    }
    return output;
  } catch {
    return null;
  }
}

function readBinding<R extends JsonValue>(
  input: unknown,
  limits: KaladaSyntaxLimits,
): SafeBinding<R> | null {
  if (!hasOnlyKeys(input, new Set(["reference", "type"]))) return null;
  const reference = dataProperty(input as object, "reference");
  const rawType = dataProperty(input as object, "type");
  if (!reference.found || !rawType.found) return null;
  const type = readStaticType(rawType.value, limits.maxStaticTypeDepth);
  if (type === null) return null;
  return Object.freeze({ reference: reference.value as R, type });
}

function dataProperty(input: object, key: string): { found: boolean; value?: unknown } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && "value" in descriptor
      ? { found: true, value: descriptor.value }
      : { found: false };
  } catch {
    return { found: false };
  }
}

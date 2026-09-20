import type { KaladaSyntaxLimits } from "./public-types.js";

export const DEFAULT_KALADA_SYNTAX_LIMITS: Readonly<KaladaSyntaxLimits> = Object.freeze({
  maxSourceLength: 100_000,
  maxTokens: 20_000,
  maxCstDepth: 64,
  maxCstNodes: 10_000,
  maxDiagnostics: 100,
  maxRecoveryTokens: 1_000,
  maxIdentifierLength: 1_000,
  maxDecodedStringLength: 10_000,
  maxStaticTypeDepth: 64,
});

export const MAXIMUM_KALADA_SYNTAX_LIMITS: Readonly<KaladaSyntaxLimits> = Object.freeze({
  maxSourceLength: 1_000_000,
  maxTokens: 200_000,
  maxCstDepth: 256,
  maxCstNodes: 100_000,
  maxDiagnostics: 1_000,
  maxRecoveryTokens: 10_000,
  maxIdentifierLength: 100_000,
  maxDecodedStringLength: 1_000_000,
  maxStaticTypeDepth: 256,
});

export function resolveSyntaxLimits(options: unknown): KaladaSyntaxLimits | null {
  if (options === undefined) return DEFAULT_KALADA_SYNTAX_LIMITS;
  if (!hasOnlyKeys(options, new Set(["limits"]))) return null;
  const limitsProperty = ownDataProperty(options, "limits");
  if (!limitsProperty.ok) return null;
  if (!limitsProperty.present) return DEFAULT_KALADA_SYNTAX_LIMITS;
  const limits = limitsProperty.value;
  if (!isPlainRecord(limits)) return null;
  const output = { ...DEFAULT_KALADA_SYNTAX_LIMITS };
  for (const key of Object.keys(DEFAULT_KALADA_SYNTAX_LIMITS) as (keyof KaladaSyntaxLimits)[]) {
    const property = ownDataProperty(limits, key);
    if (!property.ok) return null;
    if (!property.present || property.value === undefined) continue;
    const value = property.value;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAXIMUM_KALADA_SYNTAX_LIMITS[key]
    )
      return null;
    output[key] = value;
  }
  return Object.freeze(output);
}

export function ownDataProperty(
  input: unknown,
  key: PropertyKey,
): { readonly ok: boolean; readonly present: boolean; readonly value?: unknown } {
  if ((typeof input !== "object" && typeof input !== "function") || input === null)
    return { ok: false, present: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) return { ok: true, present: false };
    return "value" in descriptor
      ? { ok: true, present: true, value: descriptor.value }
      : { ok: false, present: true };
  } catch {
    return { ok: false, present: false };
  }
}

function isPlainRecord(input: unknown): input is Partial<KaladaSyntaxLimits> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    const keys = Reflect.ownKeys(input);
    const allowed = new Set(Reflect.ownKeys(DEFAULT_KALADA_SYNTAX_LIMITS));
    return keys.every((key) => typeof key === "string" && allowed.has(key));
  } catch {
    return false;
  }
}

export function hasOnlyKeys(input: unknown, allowed: ReadonlySet<string>): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    return Reflect.ownKeys(input).every((key) => typeof key === "string" && allowed.has(key));
  } catch {
    return false;
  }
}

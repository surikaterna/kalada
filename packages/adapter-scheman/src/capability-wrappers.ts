import type { StandardSchemaV1 } from "@scheman/core";
import type { ResolvedProfile } from "./profile.js";
import type { SchemanCodecOptions } from "./types.js";

type DataSlot = Readonly<{ found: true; value: unknown }> | Readonly<{ found: false }>;

export function decodeStandardSchema<Input, Output>(
  validator: StandardSchemaV1<Input, Output>,
  value: unknown,
): unknown {
  const standard = validator["~standard"];
  const outcome = standard.validate(value);
  if (isThenableWithoutGet(outcome)) return outcome;
  const issues = readDataSlot(outcome, "issues");
  if (issues.found && issues.value !== undefined)
    throw new Error("Standard Schema validation failed");
  const decoded = readDataSlot(outcome, "value");
  if (!decoded.found) throw new Error("Standard Schema returned an invalid outcome");
  return decoded.value;
}

export function convertWithFinalPolicy(
  codec: SchemanCodecOptions,
  policy: ResolvedProfile["finalValidation"],
  value: unknown,
): unknown {
  const output = codec.convert(value);
  if (isThenableWithoutGet(output)) return output;
  if (policy === "safe-integer-and-kalada-type" && !isSafeInteger(output)) {
    throw new Error("Codec output violates final conversion policy");
  }
  return output;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function readDataSlot(input: unknown, key: string): DataSlot {
  if ((typeof input !== "object" || input === null) && typeof input !== "function") {
    return Object.freeze({ found: false });
  }
  let current: object | null = input as object;
  const seen = new Set<object>();
  try {
    while (current && !seen.has(current)) {
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        return "value" in descriptor
          ? Object.freeze({ found: true, value: descriptor.value })
          : Object.freeze({ found: false });
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return Object.freeze({ found: false });
  }
  return Object.freeze({ found: false });
}

function isThenableWithoutGet(input: unknown): boolean {
  if ((typeof input !== "object" || input === null) && typeof input !== "function") return false;
  let current: object | null = input as object;
  const seen = new Set<object>();
  try {
    while (current && !seen.has(current)) {
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, "then");
      if (descriptor) return !("value" in descriptor) || typeof descriptor.value === "function";
      current = Object.getPrototypeOf(current);
    }
    return false;
  } catch {
    return true;
  }
}

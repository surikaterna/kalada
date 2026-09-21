import {
  decodeKaladaValue,
  encodeKaladaValue,
  isDuration,
  isInstant,
  isOption,
  isResult,
  type KaladaType,
  type KaladaValue,
} from "@kalada/core";
import type { KaladaSyntaxStaticType } from "@kalada/syntax";

export type CanonicalValueResult =
  | Readonly<{ ok: true; value: KaladaValue }>
  | Readonly<{ ok: false }>;

export function canonicalValue(input: unknown): CanonicalValueResult {
  try {
    const value = decodeKaladaValue(encodeKaladaValue(input as KaladaValue));
    return Object.freeze({ ok: true, value });
  } catch {
    return Object.freeze({ ok: false });
  }
}

export function matchesSemanticType(value: KaladaValue, expected: KaladaSyntaxStaticType): boolean {
  if (expected === "dynamic") return true;
  return matchesKnownType(value, expected);
}

function matchesKnownType(value: KaladaValue, expected: KaladaType): boolean {
  if (expected.kind === "primitive-type") return matchesPrimitive(value, expected.name);
  if (expected.kind === "array-type") {
    return Array.isArray(value) && value.every((item) => matchesKnownType(item, expected.element));
  }
  if (expected.kind === "option-type") {
    return (
      isOption(value) && (value.variant === "none" || matchesKnownType(value.value, expected.value))
    );
  }
  if (expected.kind === "result-type") {
    return (
      isResult(value) &&
      matchesKnownType(value.value, value.variant === "ok" ? expected.ok : expected.error)
    );
  }
  return false;
}

function matchesPrimitive(
  value: KaladaValue,
  name: Extract<KaladaType, { kind: "primitive-type" }>["name"],
): boolean {
  if (name === "json") {
    return !isOption(value) && !isResult(value) && !isInstant(value) && !isDuration(value);
  }
  if (name === "Instant") return isInstant(value);
  if (name === "Duration") return isDuration(value);
  if (name === "null") return value === null;
  return typeof value === name;
}

export function isThenableWithoutGet(input: unknown): boolean {
  if ((typeof input !== "object" || input === null) && typeof input !== "function") return false;
  let current: object | null = input as object;
  const visited = new Set<object>();
  try {
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, "then");
      if (descriptor) return !("value" in descriptor) || typeof descriptor.value === "function";
      current = Object.getPrototypeOf(current);
    }
    return false;
  } catch {
    return true;
  }
}

export type OwnValueResult = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;

export function readOwnValue(input: unknown, name: string): OwnValueResult {
  if ((typeof input !== "object" || input === null) && typeof input !== "function") {
    return Object.freeze({ ok: false });
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !("value" in descriptor)) return Object.freeze({ ok: false });
    return Object.freeze({ ok: true, value: descriptor.value });
  } catch {
    return Object.freeze({ ok: false });
  }
}

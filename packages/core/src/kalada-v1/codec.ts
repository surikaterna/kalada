import { cloneJson, dataValue, type JsonValue } from "./json.js";
import { isOption, isResult, type KaladaValue, Option, Result } from "./values.js";

export type EncodedKaladaValueV1 = {
  readonly format: "kalada-value";
  readonly version: 1;
  readonly type: "Json" | "Option" | "Result";
  readonly variant: "value" | "some" | "none" | "ok" | "err";
  readonly value?: JsonValue | EncodedKaladaValueV1;
};

const LIMITS = Object.freeze({ maxDepth: 64, maxNodes: 10_000, maxStringLength: 10_000 });

export function encodeKaladaValue(value: KaladaValue): EncodedKaladaValueV1 {
  if (isOption(value)) {
    if (value.variant === "none") return frozenEnvelope("Option", "none");
    return frozenEnvelope("Option", "some", encodeKaladaValue(value.value));
  }
  if (isResult(value))
    return frozenEnvelope("Result", value.variant, encodeKaladaValue(value.value));
  return frozenEnvelope("Json", "value", cloneJson(value, LIMITS));
}

export function decodeKaladaValue(input: unknown): KaladaValue {
  if (!looksLikeEnvelope(input)) throw new TypeError("Invalid kalada-value v1 envelope.");
  const type = dataValue(input, "type");
  const variant = dataValue(input, "variant");
  if (type === "Json" && variant === "value") return decodeJson(input);
  if (type === "Option" && variant === "none") return decodeNone(input);
  if (type === "Option" && variant === "some") return Option.some(decodePayload(input));
  if (type === "Result" && variant === "ok") return Result.ok(decodePayload(input));
  if (type === "Result" && variant === "err") return Result.err(decodePayload(input));
  throw new TypeError("Invalid kalada-value v1 envelope.");
}

function decodeJson(input: object): KaladaValue {
  assertKeys(input, ["format", "version", "type", "variant", "value"]);
  return cloneJson(dataValue(input, "value"), LIMITS);
}

function looksLikeEnvelope(input: unknown): input is object {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    return dataValue(input, "format") === "kalada-value" && dataValue(input, "version") === 1;
  } catch {
    return false;
  }
}

function decodeNone(input: object): KaladaValue {
  assertKeys(input, ["format", "version", "type", "variant"]);
  return Option.none();
}

function decodePayload(input: object): KaladaValue {
  assertKeys(input, ["format", "version", "type", "variant", "value"]);
  return decodeKaladaValue(dataValue(input, "value"));
}

function assertKeys(input: object, expected: readonly string[]): void {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new TypeError("Invalid kalada-value v1 envelope.");
  }
  if (keys.length !== expected.length || !keys.every((key) => expected.includes(String(key)))) {
    throw new TypeError("Invalid kalada-value v1 envelope.");
  }
}

function frozenEnvelope(
  type: "Json" | "Option" | "Result",
  variant: "value" | "some" | "none" | "ok" | "err",
  value?: JsonValue | EncodedKaladaValueV1,
): EncodedKaladaValueV1 {
  if (value === undefined)
    return Object.freeze({ format: "kalada-value", version: 1, type, variant });
  return Object.freeze({ format: "kalada-value", version: 1, type, variant, value });
}

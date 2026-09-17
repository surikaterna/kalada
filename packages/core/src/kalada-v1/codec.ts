import { cloneJson, cloneJsonWithStats, dataValue, type JsonValue } from "./json.js";
import { DEFAULT_KALADA_V1_LIMITS } from "./limits.js";
import { isOption, isResult, type KaladaValue, Option, Result } from "./values.js";

interface EncodedHeader {
  readonly format: "kalada-value";
  readonly version: 1;
}

export type EncodedKaladaValueV1 =
  | (EncodedHeader & {
      readonly type: "Json";
      readonly variant: "value";
      readonly value: JsonValue;
    })
  | (EncodedHeader & { readonly type: "Option"; readonly variant: "none" })
  | (EncodedHeader & {
      readonly type: "Option";
      readonly variant: "some";
      readonly value: EncodedKaladaValueV1;
    })
  | (EncodedHeader & {
      readonly type: "Result";
      readonly variant: "ok" | "err";
      readonly value: EncodedKaladaValueV1;
    });

type Frame =
  | { readonly type: "Option"; readonly variant: "some" }
  | {
      readonly type: "Result";
      readonly variant: "ok" | "err";
    };

const INVALID = "Invalid kalada-value v1 envelope.";
const LIMITS = Object.freeze({
  maxDepth: DEFAULT_KALADA_V1_LIMITS.maxValueDepth,
  maxNodes: DEFAULT_KALADA_V1_LIMITS.maxValueNodes,
  maxStringLength: DEFAULT_KALADA_V1_LIMITS.maxStringLength,
});

export function encodeKaladaValue(value: KaladaValue): EncodedKaladaValueV1 {
  const frames: Frame[] = [];
  const seen = new WeakSet<object>();
  let current = value;
  let nodes = 0;
  while (isOption(current) || isResult(current)) {
    nodes = charge(nodes, frames.length);
    if (seen.has(current)) throw new TypeError(INVALID);
    seen.add(current);
    if (isOption(current) && current.variant === "none") {
      return wrapFrames(frozenNone(), frames);
    }
    frames.push({ type: current.type, variant: current.variant } as Frame);
    current = current.value;
  }
  const remaining = LIMITS.maxNodes - charge(nodes, frames.length);
  const json = cloneJsonWithStats(current, {
    ...LIMITS,
    maxDepth: remainingDepth(frames.length),
    maxNodes: remaining,
  });
  return wrapFrames(frozenJson(json.value), frames);
}

export function decodeKaladaValue(input: unknown): KaladaValue {
  const frames: Frame[] = [];
  const active = new WeakSet<object>();
  let current = input;
  let nodes = 0;
  while (true) {
    nodes = charge(nodes, frames.length);
    const envelope = envelopeObject(current);
    if (active.has(envelope)) throw new TypeError(INVALID);
    active.add(envelope);
    const fields = envelopeFields(envelope);
    if (fields.type === "Json" && fields.variant === "value") {
      assertKeys(envelope, ["format", "version", "type", "variant", "value"]);
      const value = decodeJson(dataValue(envelope, "value"), nodes, frames.length);
      return wrapValues(value, frames);
    }
    if (fields.type === "Option" && fields.variant === "none") {
      assertKeys(envelope, ["format", "version", "type", "variant"]);
      return wrapValues(Option.none(), frames);
    }
    frames.push(payloadFrame(fields.type, fields.variant));
    assertKeys(envelope, ["format", "version", "type", "variant", "value"]);
    current = dataValue(envelope, "value");
  }
}

function decodeJson(input: unknown, nodes: number, depth: number): JsonValue {
  return cloneJson(input, {
    ...LIMITS,
    maxDepth: remainingDepth(depth),
    maxNodes: LIMITS.maxNodes - nodes,
  });
}

function envelopeObject(input: unknown): object {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new TypeError(INVALID);
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(INVALID);
    return input;
  } catch {
    throw new TypeError(INVALID);
  }
}

function envelopeFields(input: object): { type: unknown; variant: unknown } {
  try {
    if (dataValue(input, "format") !== "kalada-value" || dataValue(input, "version") !== 1) {
      throw new TypeError(INVALID);
    }
    return { type: dataValue(input, "type"), variant: dataValue(input, "variant") };
  } catch {
    throw new TypeError(INVALID);
  }
}

function payloadFrame(type: unknown, variant: unknown): Frame {
  if (type === "Option" && variant === "some") return { type, variant };
  if (type === "Result" && (variant === "ok" || variant === "err")) return { type, variant };
  throw new TypeError(INVALID);
}

function assertKeys(input: object, expected: readonly string[]): void {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new TypeError(INVALID);
  }
  if (
    keys.length !== expected.length ||
    !keys.every((key) => typeof key === "string" && expected.includes(key))
  ) {
    throw new TypeError(INVALID);
  }
}

function wrapFrames(leaf: EncodedKaladaValueV1, frames: readonly Frame[]): EncodedKaladaValueV1 {
  let output = leaf;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (!frame) throw new TypeError(INVALID);
    output = Object.freeze({ format: "kalada-value", version: 1, ...frame, value: output });
  }
  return output;
}

function wrapValues(leaf: KaladaValue, frames: readonly Frame[]): KaladaValue {
  let output = leaf;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (!frame) throw new TypeError(INVALID);
    output =
      frame.type === "Option"
        ? Option.some(output)
        : frame.variant === "ok"
          ? Result.ok(output)
          : Result.err(output);
  }
  return output;
}

function charge(nodes: number, depth: number): number {
  if (depth > LIMITS.maxDepth || nodes >= LIMITS.maxNodes)
    throw new RangeError("Kalada value exceeds its limits.");
  return nodes + 1;
}

function remainingDepth(depth: number): number {
  const remaining = LIMITS.maxDepth - depth;
  if (remaining < 0) throw new RangeError("Kalada value exceeds its limits.");
  return remaining;
}

function frozenNone(): EncodedKaladaValueV1 {
  return Object.freeze({ format: "kalada-value", version: 1, type: "Option", variant: "none" });
}

function frozenJson(value: JsonValue): EncodedKaladaValueV1 {
  return Object.freeze({
    format: "kalada-value",
    version: 1,
    type: "Json",
    variant: "value",
    value,
  });
}

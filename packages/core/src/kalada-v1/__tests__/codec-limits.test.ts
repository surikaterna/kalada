import { expect, it } from "vitest";
import {
  decodeKaladaValue,
  type EncodedKaladaValueV1,
  encodeKaladaValue,
  type KaladaValue,
  Option,
} from "../index.js";

function deeplyBranded(depth: number): KaladaValue {
  let value: KaladaValue = null;
  for (let index = 0; index < depth; index += 1) value = Option.some(value);
  return value;
}

function deeplyEncoded(depth: number): unknown {
  let value: unknown = {
    format: "kalada-value",
    version: 1,
    type: "Json",
    variant: "value",
    value: null,
  };
  for (let index = 0; index < depth; index += 1) {
    value = { format: "kalada-value", version: 1, type: "Option", variant: "some", value };
  }
  return value;
}

it("prebounds deeply nested runtime and encoded ADTs without overflowing the stack", () => {
  expect(() => encodeKaladaValue(deeplyBranded(20_000))).toThrow(RangeError);
  expect(() => decodeKaladaValue(deeplyEncoded(20_000))).toThrow(RangeError);
});

it("contains cycles in encoded envelopes and JSON payloads", () => {
  const envelope: Record<string, unknown> = {
    format: "kalada-value",
    version: 1,
    type: "Option",
    variant: "some",
  };
  envelope.value = envelope;
  expect(() => decodeKaladaValue(envelope)).toThrow(TypeError);
  const json: Record<string, unknown> = {
    format: "kalada-value",
    version: 1,
    type: "Json",
    variant: "value",
  };
  json.value = json;
  expect(() => decodeKaladaValue(json)).toThrow(TypeError);
});

it("contains hostile encoded accessors and proxies", () => {
  const accessor = Object.defineProperty({}, "format", {
    enumerable: true,
    get: () => "kalada-value",
  });
  expect(() => decodeKaladaValue(accessor)).toThrow(TypeError);
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new Error("no");
      },
    },
  );
  expect(() => decodeKaladaValue(proxy)).toThrow(TypeError);
  const keysProxy = new Proxy(
    { format: "kalada-value", version: 1, type: "Option", variant: "none" },
    {
      ownKeys: () => {
        throw new Error("no");
      },
    },
  );
  expect(() => decodeKaladaValue(keysProxy)).toThrow(TypeError);
});

it("enforces exact codec string and flat-container boundaries", () => {
  expect(() => encodeKaladaValue("x".repeat(10_000))).not.toThrow();
  expect(() => encodeKaladaValue("x".repeat(10_001))).toThrow(RangeError);
  const accepted = Array.from({ length: 9_998 }, () => null);
  const rejected = Array.from({ length: 9_999 }, () => null);
  const encoded = encodeKaladaValue(accepted);
  expect(() => decodeKaladaValue(encoded)).not.toThrow();
  expect(() => encodeKaladaValue(rejected)).toThrow(RangeError);
});

it("rejects extra encoded properties before constructing runtime values", () => {
  const input: EncodedKaladaValueV1 & { extra?: boolean } = {
    format: "kalada-value",
    version: 1,
    type: "Option",
    variant: "none",
    extra: true,
  };
  expect(() => decodeKaladaValue(input)).toThrow(TypeError);
});

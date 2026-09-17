import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import {
  encodeKaladaValue,
  KALADA_V1_PROGRAM_SCHEMA,
  KALADA_VALUE_V1_SCHEMA,
  KaladaV1,
  Option,
} from "../index.js";

it("publishes deeply frozen canonical schemas", () => {
  expect(Object.isFrozen(KALADA_V1_PROGRAM_SCHEMA)).toBe(true);
  expect(Object.isFrozen(KALADA_VALUE_V1_SCHEMA)).toBe(true);
  expect(Object.isFrozen(KALADA_V1_PROGRAM_SCHEMA.$defs)).toBe(true);
});

it("validates canonical programs and rejects noncanonical arm order", () => {
  const validate = new Ajv2020({ strict: true }).compile(KALADA_V1_PROGRAM_SCHEMA);
  const arms = [
    KaladaV1.arm("some", KaladaV1.literal(1), "value"),
    KaladaV1.arm("none", KaladaV1.literal(0)),
  ];
  const canonical = KaladaV1.program(KaladaV1.match("Option", KaladaV1.Option.none(), arms));
  expect(validate(canonical)).toBe(true);
  expect(
    validate(KaladaV1.program(KaladaV1.match("Option", KaladaV1.Option.none(), arms.reverse()))),
  ).toBe(false);
});

it("validates universal encoded values including opaque collision-shaped JSON", () => {
  const validate = new Ajv2020({ strict: true }).compile(KALADA_VALUE_V1_SCHEMA);
  const collision = { format: "kalada-value", version: 1, type: "Option", variant: "none" };
  const encoded = encodeKaladaValue(Option.some(collision));
  expect(validate(encoded)).toBe(true);
  expect(encoded).toMatchObject({ value: { type: "Json", value: collision } });
});

it("aligns expressible reference, string, and flat-container boundaries", () => {
  const program = new Ajv2020({ strict: true }).compile(KALADA_V1_PROGRAM_SCHEMA);
  const values = new Ajv2020({ strict: true }).compile(KALADA_VALUE_V1_SCHEMA);
  expect(program(KaladaV1.program(KaladaV1.ref("r".repeat(1_000))))).toBe(true);
  expect(program(KaladaV1.program(KaladaV1.ref("r".repeat(1_001))))).toBe(false);
  expect(values(encodeKaladaValue("x".repeat(10_000)))).toBe(true);
  expect(values(encodeKaladaValue(Array.from({ length: 9_998 }, () => null)))).toBe(true);
  const oversized = {
    format: "kalada-value",
    version: 1,
    type: "Json",
    variant: "value",
    value: Array.from({ length: 9_999 }, () => null),
  };
  expect(values(oversized)).toBe(false);
});

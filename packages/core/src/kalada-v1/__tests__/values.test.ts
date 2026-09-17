import { describe, expect, it } from "vitest";
import {
  decodeKaladaValue,
  encodeKaladaValue,
  equalKaladaValues,
  isOption,
  isResult,
  Option,
  Result,
} from "../index.js";

describe("kalada-v1 values", () => {
  it("brands values privately and rejects spoofs, copies, and JSON round trips", () => {
    const value = Option.some({ nested: [1] });
    expect(isOption(value)).toBe(true);
    expect(isOption({ type: "Option", variant: "some", value: { nested: [1] } })).toBe(false);
    expect(isOption({ ...value })).toBe(false);
    expect(isOption(JSON.parse(JSON.stringify(value)))).toBe(false);
    expect(isResult(Result.err("no"))).toBe(true);
  });

  it("deeply freezes snapshots, canonicalizes -0, and rejects unsafe JSON", () => {
    const source = { nested: [-0] };
    const value = Option.some(source);
    source.nested[0] = 2;
    expect(value.value).toEqual({ nested: [0] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen((value.value as { nested: number[] }).nested)).toBe(true);
    expect(() => Option.some(Number.NaN)).toThrow();
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => Result.ok(cycle as never)).toThrow();
  });

  it("compares JSON and recursively branded values structurally", () => {
    expect(equalKaladaValues(Option.some(Result.ok([1])), Option.some(Result.ok([1])))).toBe(true);
    expect(equalKaladaValues(Option.none(), Option.none())).toBe(true);
    expect(equalKaladaValues(Result.err(1), Result.ok(1))).toBe(false);
  });

  it("uses an explicit versioned codec and never implicitly decodes JSON", () => {
    const encoded = encodeKaladaValue(Option.some(Result.err({ reason: "bad" })));
    const decoded = decodeKaladaValue(JSON.parse(JSON.stringify(encoded)));
    expect(isOption(decoded)).toBe(true);
    expect(equalKaladaValues(decoded, Option.some(Result.err({ reason: "bad" })))).toBe(true);
    const opaque = { format: "kalada-value", version: 2, type: "Option", variant: "none" };
    expect(decodeKaladaValue(opaque)).toEqual(opaque);
  });

  it("rejects malformed v1 envelopes and hostile descriptors", () => {
    expect(() => decodeKaladaValue({ format: "kalada-value", version: 1, type: "Option", variant: "wat" })).toThrow();
    const hostile = Object.defineProperty({}, "format", { enumerable: true, get: () => "kalada-value" });
    expect(() => decodeKaladaValue(hostile)).toThrow();
    expect(() => decodeKaladaValue(new Proxy({}, { ownKeys: () => { throw new Error("no"); } }))).toThrow();
  });
});

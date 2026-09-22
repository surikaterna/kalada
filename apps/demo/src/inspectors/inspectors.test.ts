import { describe, expect, it, vi } from "vitest";
import { cstSnapshot, diagnosticsSnapshot } from "./artifacts.js";
import { safeJson, safeValue } from "./safe.js";

describe("safe inspector snapshots", () => {
  it("redacts source and literals unless explicitly revealed", () => {
    const hidden = JSON.stringify(cstSnapshot('secret + "classified"'));
    expect(hidden).not.toContain("secret");
    expect(hidden).not.toContain("classified");
    const revealed = JSON.stringify(cstSnapshot('secret + "classified"', true));
    expect(revealed).toContain("secret");
    expect(Object.isFrozen(cstSnapshot("data"))).toBe(true);
  });

  it("does not invoke getters or toJSON and represents cycles", () => {
    const getter = vi.fn(() => "SECRET");
    const value: Record<string, unknown> = { visible: 1, toJSON: () => "SECRET" };
    Object.defineProperty(value, "hidden", { enumerable: true, get: getter });
    value.self = value;
    const text = safeJson(value);
    expect(getter).not.toHaveBeenCalled();
    expect(text).not.toContain("SECRET");
    expect(text).toContain("accessor-redacted");
    expect(text).toContain("reference");
  });

  it("tags bigint, undefined, nonfinite values and freezes copies", () => {
    const snapshot = safeValue({ big: 1n, missing: undefined, bad: Number.NaN }) as Record<
      string,
      unknown
    >;
    expect(snapshot).toMatchObject({
      big: { type: "bigint", decimal: "1" },
      missing: { type: "undefined" },
      bad: { type: "nonfinite" },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("allowlists diagnostics without stacks or arbitrary values", () => {
    const snapshot = diagnosticsSnapshot([
      { code: "SAFE", phase: "bind", message: "fixed", stack: "SECRET", value: "SECRET" },
    ]);
    const text = JSON.stringify(snapshot);
    expect(text).toContain("SAFE");
    expect(text).not.toContain("SECRET");
  });
});

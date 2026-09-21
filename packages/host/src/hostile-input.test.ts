import { describe, expect, it } from "vitest";
import { cloneSerializableData, normalizeManualEnvironment } from "./index.js";

describe("hostile input safety", () => {
  it("clones and freezes serializable data without retaining source aliases", () => {
    const source = { nested: [{ value: 1 }] };
    const result = cloneSerializableData(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nested = source.nested[0];
    if (nested) nested.value = 2;
    expect(result.value).toEqual({ nested: [{ value: 1 }] });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen((result.value as { nested: readonly unknown[] }).nested)).toBe(true);
  });

  it("rejects cycles, accessors, non-finite numbers, and functions", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, "secret", {
      get() {
        throw new Error("must not execute");
      },
    });
    expect(cloneSerializableData(cyclic)).toMatchObject({ ok: false, reason: "cycle" });
    expect(cloneSerializableData(accessor)).toMatchObject({ ok: false, reason: "accessor" });
    expect(cloneSerializableData(Number.POSITIVE_INFINITY)).toMatchObject({ ok: false });
    expect(cloneSerializableData(() => undefined)).toMatchObject({ ok: false });
  });

  it("returns stable sanitized diagnostics without reading accessors", () => {
    let accessed = false;
    const metadata = Object.defineProperty({}, "token", {
      get() {
        accessed = true;
        throw new Error("SECRET stack and value");
      },
    });
    const result = normalizeManualEnvironment({
      mode: "sync",
      bindings: [
        {
          id: "unsafe",
          name: "unsafe",
          path: ["unsafe"],
          semanticType: "dynamic",
          metadata,
          provenance: [{ providerId: "safe-provider", source: "manual" }],
        },
      ],
    });
    expect(accessed).toBe(false);
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "HOST_ENVIRONMENT_INVALID_METADATA",
          phase: "environment",
          message: "Binding metadata is not bounded serializable data.",
          bindingPath: ["unsafe"],
          provenance: { providerId: "manual" },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|stack|value/u);
  });
});

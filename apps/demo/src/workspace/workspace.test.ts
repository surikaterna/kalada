import { describe, expect, it, vi } from "vitest";
import { BUILTIN_WORKSPACE } from "../examples/builtin.js";
import { clearWorkspace, restoreWorkspace, saveWorkspace } from "./persistence.js";
import { exportWorkspace, importWorkspace, validateEnvelope } from "./transfer.js";

describe("workspace transfer and persistence", () => {
  it("round-trips only the exact bounded versioned envelope", () => {
    expect(importWorkspace(exportWorkspace(BUILTIN_WORKSPACE))).toEqual(BUILTIN_WORKSPACE);
    expect(() => validateEnvelope({ ...BUILTIN_WORKSPACE, output: "secret" })).toThrowError(
      expect.objectContaining({ code: "TRANSFER_SHAPE" }),
    );
    expect(() => validateEnvelope({ ...BUILTIN_WORKSPACE, version: 2 })).toThrowError(
      expect.objectContaining({ code: "TRANSFER_VERSION" }),
    );
  });

  it("rejects unsafe names, duplicate docs, and invalid active documents atomically", () => {
    const documents = [...BUILTIN_WORKSPACE.documents];
    const first = documents[0];
    if (!first) throw new Error("fixture missing");
    documents[0] = { ...first, name: "../bad.kalada" };
    expect(() => validateEnvelope({ ...BUILTIN_WORKSPACE, documents })).toThrow();
    expect(() =>
      validateEnvelope({ ...BUILTIN_WORKSPACE, activeName: "missing.kalada" }),
    ).toThrow();
  });

  it("does not invoke accessors", () => {
    const getter = vi.fn(() => BUILTIN_WORKSPACE.schemaText);
    const hostile = { ...BUILTIN_WORKSPACE } as Record<string, unknown>;
    Object.defineProperty(hostile, "schemaText", { get: getter, enumerable: true });
    expect(() => validateEnvelope(hostile)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("handles restore corruption and storage quota failure safely", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as Storage;
    expect(saveWorkspace(storage, BUILTIN_WORKSPACE).ok).toBe(true);
    expect(restoreWorkspace(storage).value).toEqual(BUILTIN_WORKSPACE);
    expect(clearWorkspace(storage).ok).toBe(true);
    storage.setItem = () => {
      throw new DOMException("quota");
    };
    expect(saveWorkspace(storage, BUILTIN_WORKSPACE)).toEqual({
      ok: false,
      code: "PERSISTENCE_UNAVAILABLE",
    });
  });
});

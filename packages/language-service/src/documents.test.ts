import { describe, expect, it } from "vitest";
import { createLanguageService, LanguageServiceError } from "./index.js";
import { validEnvironment } from "./test-support.js";

const environment = () => ({ generation: 0, description: validEnvironment() });

describe("versioned documents", () => {
  it("rejects duplicate opens and preserves per-URI high-water marks across close", () => {
    const service = createLanguageService(environment());
    const first = service.openDocument({ uri: "opaque:a", version: 4, text: "1" });
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => service.openDocument({ uri: "opaque:a", version: 5, text: "2" })).toThrowError(
      error("DUPLICATE_DOCUMENT"),
    );
    expect(service.closeDocument("opaque:a")).toBe(first);
    expect(() => service.openDocument({ uri: "opaque:a", version: 4, text: "2" })).toThrowError(
      error("VERSION_NOT_MONOTONIC"),
    );
    expect(service.openDocument({ uri: "opaque:a", version: 5, text: "2" }).version).toBe(5);
  });

  it("requires opaque non-empty URIs and non-negative safe-integer versions", () => {
    const service = createLanguageService(environment());
    expect(() => service.openDocument({ uri: "", version: 0, text: "" })).toThrowError(
      error("INVALID_URI"),
    );
    expect(() => service.openDocument({ uri: " ", version: 0, text: "" })).not.toThrow();
    expect(() => service.openDocument({ uri: "negative", version: -1, text: "" })).toThrowError(
      error("INVALID_VERSION"),
    );
    expect(() =>
      service.openDocument({ uri: "unsafe", version: Number.MAX_SAFE_INTEGER + 1, text: "" }),
    ).toThrowError(error("INVALID_VERSION"));
  });

  it("validates batched edits against the old snapshot and commits atomically", () => {
    const service = createLanguageService(environment());
    const old = service.openDocument({ uri: "doc", version: 1, text: "alpha beta" });
    const updated = service.updateDocument({
      uri: "doc",
      version: 2,
      edits: [
        { range: range(0, 6, 0, 10), text: "B" },
        { range: range(0, 0, 0, 5), text: "A" },
      ],
    });
    expect(updated.text).toBe("A B");
    expect(old.text).toBe("alpha beta");
    expect(() =>
      service.updateDocument({
        uri: "doc",
        version: 3,
        edits: [
          { range: range(0, 0, 0, 2), text: "x" },
          { range: range(0, 1, 0, 3), text: "y" },
        ],
      }),
    ).toThrowError(error("OVERLAPPING_EDITS"));
    expect(service.getDocument("doc")).toBe(updated);
    expect(service.updateDocument({ uri: "doc", version: 3, edits: [] }).version).toBe(3);
  });

  it("applies UTF-16 edits across astral and combining code units without consuming CRLF", () => {
    const service = createLanguageService(environment());
    service.openDocument({ uri: "unicode", version: 1, text: "😀e\u0301\r\nx" });
    const updated = service.updateDocument({
      uri: "unicode",
      version: 2,
      edits: [{ range: range(0, 2, 0, 4), text: "Q" }],
    });
    expect(updated.text).toBe("😀Q\r\nx");
    expect(updated.lineIndex.offsetAt({ line: 1, character: 0 })).toBe(5);
  });

  it("keeps documents and workspace identities isolated and immutable", () => {
    const service = createLanguageService(environment());
    service.openDocument({ uri: "z", version: 1, text: "1" });
    service.openDocument({ uri: "a", version: 7, text: "2" });
    const workspace = service.getWorkspaceSnapshot();
    expect(workspace.documents).toEqual([
      { uri: "a", version: 7 },
      { uri: "z", version: 1 },
    ]);
    expect(Object.isFrozen(workspace.documents)).toBe(true);
    expect(service.isWorkspaceCurrent(workspace)).toBe(true);
    service.updateDocument({ uri: "z", version: 2, edits: [] });
    expect(service.isWorkspaceCurrent(workspace)).toBe(false);
    expect(service.getDocument("a")?.version).toBe(7);
  });

  it("checks monotonic environment generations", () => {
    const service = createLanguageService(environment());
    const before = service.getEnvironment();
    expect(() =>
      service.updateEnvironment({ generation: 0, description: validEnvironment() }),
    ).toThrowError(error("ENVIRONMENT_GENERATION_NOT_MONOTONIC"));
    expect(service.getEnvironment()).toBe(before);
    expect(
      service.updateEnvironment({ generation: 1, description: validEnvironment() }).generation,
    ).toBe(1);
  });
});

function range(startLine: number, start: number, endLine: number, end: number) {
  return {
    start: { line: startLine, character: start },
    end: { line: endLine, character: end },
  };
}

function error(code: string): LanguageServiceError {
  return new LanguageServiceError(code as never);
}

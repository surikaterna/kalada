import { describe, expect, it } from "vitest";
import { createLanguageService } from "./service.js";
import { validEnvironment } from "./test-support.js";

function fixture(text: string) {
  const service = createLanguageService({ generation: 1, description: validEnvironment() });
  service.openDocument({ uri: "file:///a", version: 1, text });
  return service;
}

describe("recovery highlight", () => {
  it("classifies fields, incomplete and invalid tokens in UTF-16 order without overlap", () => {
    const text = '😀\r\ndata.\nprice?.field + 1 xor null\r"unterminated';
    const service = fixture(text);
    const result = service.highlight("file:///a");
    expect(result.kind).toBe("highlight");
    if (result.kind !== "highlight") return;
    expect(result.spans.map(({ kind }) => kind)).toContain("invalid");
    const document = service.getDocument("file:///a");
    if (!document) throw new Error("missing document");
    for (const [index, span] of result.spans.entries()) {
      expect(span.from).toBeGreaterThanOrEqual(result.spans[index - 1]?.to ?? 0);
      expect(span.to).toBeLessThanOrEqual(text.length);
      expect(document.lineIndex.offsetAt(document.lineIndex.positionAt(span.from))).toBe(span.from);
      expect(Object.isFrozen(span)).toBe(true);
    }
    expect(Object.isFrozen(result.spans)).toBe(true);
    expect(service.highlight("file:///a")).toEqual(result);
  });

  it("distinguishes field tokens from references on recoverable input", () => {
    const result = fixture("data. + price?.field").highlight("file:///a");
    expect(result.kind === "highlight" && result.spans.map(({ kind }) => kind)).toContain("field");
    expect(result.kind === "highlight" && result.spans.map(({ kind }) => kind)).toContain(
      "reference",
    );
  });

  it("tracks generation, version, other documents, and pre/post parse cancellation", () => {
    const service = fixture("data.");
    service.openDocument({ uri: "file:///b", version: 1, text: "true" });
    const initial = service.highlight("file:///a");
    expect(initial.kind).toBe("highlight");
    const before = service.highlight("file:///a", {
      cancellation: { isCancellationRequested: () => true },
    });
    expect(before).toMatchObject({
      kind: "cancelled",
      checkpoint: "captured",
      operation: "highlight",
    });
    let calls = 0;
    const after = service.highlight("file:///a", {
      cancellation: { isCancellationRequested: () => ++calls === 3 },
    });
    expect(after).toMatchObject({ kind: "cancelled", checkpoint: "after-parse" });
    service.updateEnvironment({ generation: 2, description: validEnvironment() });
    if (initial.kind === "highlight") expect(service.isCurrent(initial)).toBe(false);
    expect(service.highlight("file:///b")).toMatchObject({
      status: "current",
      environmentGeneration: 2,
    });
    service.updateDocument({
      uri: "file:///a",
      version: 2,
      edits: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          text: "price",
        },
      ],
    });
    expect(service.highlight("file:///a")).toMatchObject({ version: 2, status: "current" });
  });

  it("bounds oversized text without expanding token spans", () => {
    const service = fixture("x".repeat(200_000));
    const result = service.highlight("file:///a");
    expect(result.kind === "highlight" && result.spans.length).toBeLessThanOrEqual(1);
  });
});

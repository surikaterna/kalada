import { parseKaladaV1Expression } from "@kalada/syntax";
import { describe, expect, it } from "vitest";
import { createLanguageService } from "./service.js";
import { validEnvironment } from "./test-support.js";

function fixture(text = "price + 1") {
  const service = createLanguageService({ generation: 1, description: validEnvironment() });
  service.openDocument({ uri: "memory:///a", version: 1, text });
  return service;
}

const position = { line: 0, character: 0 };

describe("shared current-document syntax parsing", () => {
  it("preserves highlights, tooling, analysis and stale currentness across environment and edits", () => {
    const service = fixture('"🚀"\r\n + price.');
    const original = service.highlight("memory:///a");
    expect(original.kind).toBe("highlight");
    expect(service.hover("memory:///a", position).kind).toBe("hover");
    expect(service.completion("memory:///a", position).kind).toBe("completion");
    expect(service.highlight("memory:///a")).toEqual(original);
    expect(service.diagnostics("memory:///a")).toEqual(service.diagnostics("memory:///a"));
    service.updateEnvironment({ generation: 2, description: validEnvironment() });
    if (original.kind === "highlight") expect(service.isCurrent(original)).toBe(false);
    const before = service.highlight("memory:///a");
    expect(before).toMatchObject({ environmentGeneration: 2, status: "current" });
    const snapshot = service.getDocument("memory:///a");
    if (!snapshot) throw Error("missing document");
    service.updateDocument({
      uri: snapshot.uri,
      version: 2,
      edits: [
        {
          range: {
            start: snapshot.lineIndex.positionAt(snapshot.text.length),
            end: snapshot.lineIndex.positionAt(snapshot.text.length),
          },
          text: " ",
        },
      ],
    });
    if (before.kind === "highlight") expect(service.isCurrent(before)).toBe(false);
    expect(service.highlight("memory:///a")).toMatchObject({ version: 2, status: "current" });
    expect(service.analyze("memory:///a").kind).toBe("analysis");
  });

  it("keeps cancellation checkpoints even for a cached hit and discards closed snapshots", () => {
    const service = fixture("price + 1");
    service.highlight("memory:///a");
    let calls = 0;
    const cancelled = service.highlight("memory:///a", {
      cancellation: { isCancellationRequested: () => ++calls === 3 },
    });
    expect(cancelled).toMatchObject({ kind: "cancelled", checkpoint: "after-parse" });
    const cachedTooling = service.hover("memory:///a", position);
    expect(cachedTooling).toMatchObject({ kind: "hover", version: 1 });
    const closed = service.closeDocument("memory:///a");
    expect(closed.text).toBe("price + 1");
    service.openDocument({ uri: "memory:///a", text: "price. + 2", version: 2 });
    const parsed = parseKaladaV1Expression("price. + 2");
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(service.highlight("memory:///a")).toMatchObject({ kind: "highlight", version: 2 });
    expect(service.completion("memory:///a", position).kind).toBe("completion");
    expect(service.hover("memory:///a", position).kind).toBe("hover");
  });

  it("does not admit a superseded captured snapshot after a cancellation callback races an edit", () => {
    const service = fixture();
    let calls = 0;
    const stale = service.highlight("memory:///a", {
      cancellation: {
        isCancellationRequested: () => {
          calls += 1;
          if (calls === 2) service.updateDocument({ uri: "memory:///a", version: 2, edits: [] });
          return false;
        },
      },
    });
    expect(stale).toMatchObject({ kind: "highlight", status: "stale", version: 1 });
    expect(service.highlight("memory:///a")).toMatchObject({
      kind: "highlight",
      status: "current",
      version: 2,
    });
  });

  it("keeps multi-document edits and undo/redo versions independent", () => {
    const service = fixture("price + 1");
    service.openDocument({ uri: "memory:///b", version: 1, text: "price. + 2" });
    const other = service.highlight("memory:///b");
    service.highlight("memory:///a");
    for (const [version, text] of [
      [2, "price + 2"],
      [3, "price + 1"],
      [4, "price + 2"],
    ] as const) {
      const current = service.getDocument("memory:///a");
      if (!current) throw Error("missing document");
      service.updateDocument({
        uri: current.uri,
        version,
        edits: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: current.lineIndex.positionAt(current.text.length),
            },
            text,
          },
        ],
      });
      expect(service.highlight("memory:///a")).toMatchObject({ version, status: "current" });
      expect(service.getDocument("memory:///a")?.text).toBe(text);
      expect(service.highlight("memory:///b")).toEqual(other);
    }
  });

  it("preserves before- and after-parse tooling cancellation on cache hits", () => {
    const service = fixture();
    service.highlight("memory:///a");
    let checks = 0;
    const completion = service.completion("memory:///a", position, {
      cancellation: { isCancellationRequested: () => ++checks === 4 },
    });
    expect(completion).toMatchObject({ kind: "cancelled", checkpoint: "after-parse" });
    const hover = service.hover("memory:///a", position, {
      cancellation: { isCancellationRequested: () => true },
    });
    expect(hover).toMatchObject({ kind: "cancelled", checkpoint: "captured" });
    expect(service.completion("memory:///a", position).kind).toBe("completion");
  });
});

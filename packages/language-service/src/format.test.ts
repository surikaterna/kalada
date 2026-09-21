import { formatKaladaV1Expression } from "@kalada/syntax";
import { describe, expect, it } from "vitest";
import { createLanguageService } from "./index.js";
import { validEnvironment } from "./test-support.js";

describe("formatting", () => {
  it("delegates to syntax and returns a deterministic whole-document edit", () => {
    const source = "1+  2";
    const expected = formatKaladaV1Expression(source);
    if (!expected.ok) throw new Error("Expected format success");
    const service = createLanguageService({ generation: 0, description: validEnvironment() });
    service.openDocument({ uri: "doc", version: 4, text: source });
    const result = service.format("doc");
    expect(result).toMatchObject({
      kind: "format",
      uri: "doc",
      version: 4,
      environmentGeneration: 0,
      status: "current",
      diagnostics: [],
      edit: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: source.length },
        },
        text: expected.text,
      },
    });
    if (result.kind !== "format" || !result.edit) throw new Error("Expected edit");
    service.updateDocument({ uri: "doc", version: 5, edits: [result.edit] });
    const idempotent = service.format("doc");
    expect(idempotent.kind === "format" ? idempotent.edit : "cancelled").toBeNull();
  });

  it("preserves formatter diagnostic causes and emits no edit on invalid syntax", () => {
    const service = createLanguageService({ generation: 0, description: validEnvironment() });
    service.openDocument({ uri: "doc", version: 1, text: "1 +" });
    const result = service.format("doc");
    if (result.kind !== "format") throw new Error("Unexpected cancellation");
    expect(result.edit).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(Object.isFrozen(result.diagnostics[0]?.cause)).toBe(true);
  });

  it("cancels at each formatting checkpoint with no edit or diagnostics", () => {
    const checkpoints = ["captured", "formatted", "complete"] as const;
    for (const [target, checkpoint] of checkpoints.entries()) {
      const service = createLanguageService({ generation: 0, description: validEnvironment() });
      service.openDocument({ uri: "doc", version: 1, text: "1+2" });
      let calls = 0;
      const result = service.format("doc", {
        cancellation: { isCancellationRequested: () => calls++ === target },
      });
      expect(result).toMatchObject({ kind: "cancelled", operation: "format", checkpoint });
      expect("edit" in result).toBe(false);
      expect("diagnostics" in result).toBe(false);
    }
  });
});

import { ChangeSet, Text } from "@codemirror/state";
import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";
import { describe, expect, it } from "vitest";
import { changesToEdits, rangeToOffsets } from "./translation.js";

function snapshot(text: string) {
  const service = createLanguageService({
    generation: 1,
    description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
  });
  return service.openDocument({ uri: "memory:///translate.kalada", version: 1, text });
}

describe("CodeMirror translation", () => {
  it("translates transaction batches against old UTF-16 coordinates", () => {
    const old = Text.of(["😀ab", "cd"]);
    const changes = ChangeSet.of(
      [
        { from: 2, to: 3, insert: "A" },
        { from: 6, to: 7, insert: "D" },
      ],
      old.length,
    );
    expect(changesToEdits(old, changes.apply(old), changes, snapshot(old.toString()))).toEqual([
      {
        range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } },
        text: "A",
      },
      {
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } },
        text: "D",
      },
    ]);
  });

  it("rejects invalid editor ranges and preserves CRLF offsets", () => {
    const document = Text.of(["a", "b"]);
    expect(
      rangeToOffsets(document, {
        start: { line: 0, character: 1 },
        end: { line: 1, character: 1 },
      }),
    ).toEqual({ from: 1, to: 3 });
    expect(
      rangeToOffsets(document, {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 2 },
      }),
    ).toBeNull();
  });
});

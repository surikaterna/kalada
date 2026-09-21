import { describe, expect, it } from "vitest";
import { createUtf16LineIndex, LanguageServiceError } from "./index.js";

describe("UTF-16 line index", () => {
  it("counts astral pairs and combining marks as UTF-16 code units", () => {
    const text = "A😀e\u0301Z";
    const index = createUtf16LineIndex(text);
    expect(text.length).toBe(6);
    expect(index.positionAt(1)).toEqual({ line: 0, character: 1 });
    expect(index.positionAt(2)).toEqual({ line: 0, character: 2 });
    expect(index.positionAt(3)).toEqual({ line: 0, character: 3 });
    expect(index.offsetAt({ line: 0, character: 5 })).toBe(5);
  });

  it("treats CRLF as one break and supports LF and standalone CR", () => {
    const index = createUtf16LineIndex("a\r\nb\nc\rd");
    expect(index.lineCount).toBe(4);
    expect(index.positionAt(1)).toEqual({ line: 0, character: 1 });
    expect(index.positionAt(2)).toEqual({ line: 0, character: 1 });
    expect(index.positionAt(3)).toEqual({ line: 1, character: 0 });
    expect(index.offsetAt({ line: 1, character: 0 })).toBe(3);
    expect(index.offsetAt({ line: 2, character: 1 })).toBe(6);
    expect(index.offsetAt({ line: 3, character: 1 })).toBe(8);
  });

  it("defines start, end, trailing newline, and invalid boundaries", () => {
    const index = createUtf16LineIndex("x\n");
    expect(index.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(index.positionAt(2)).toEqual({ line: 1, character: 0 });
    expect(index.offsetAt({ line: 0, character: 1 })).toBe(1);
    expect(index.offsetAt({ line: 1, character: 0 })).toBe(2);
    expect(() => index.positionAt(3)).toThrowError(invalidRange());
    expect(() => index.offsetAt({ line: 0, character: 2 })).toThrowError(invalidRange());
    expect(() => index.offsetAt({ line: 2, character: 0 })).toThrowError(invalidRange());
  });
});

function invalidRange(): LanguageServiceError {
  return new LanguageServiceError("INVALID_RANGE");
}

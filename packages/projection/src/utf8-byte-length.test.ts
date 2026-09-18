import { describe, expect, it } from "vitest";
import { utf8ByteLength } from "./utf8-byte-length.js";

describe("UTF-8 byte length", () => {
  it.each([
    ["ASCII", 5],
    ["é", 2],
    ["😀", 4],
    ["\ud800", 3],
    ["\udc00", 3],
  ])("counts %j with scalar and replacement semantics", (value, expected) => {
    expect(utf8ByteLength(value)).toBe(expected);
    expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength);
  });

  it.each(["\ud800", "\udc00"])("counts JSON escaping for lone surrogate %j", (value) => {
    const token = JSON.stringify(value);
    expect(token).toMatch(/^"\\ud[89a-f][0-9a-f]{2}"$/u);
    expect(utf8ByteLength(token)).toBe(8);
  });
});

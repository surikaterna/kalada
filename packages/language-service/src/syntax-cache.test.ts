import { parseKaladaV1Expression } from "@kalada/syntax";
import { describe, expect, it } from "vitest";
import type { DocumentSnapshot } from "./contracts.js";
import { createUtf16LineIndex } from "./line-index.js";
import { SyntaxParseCache } from "./syntax-cache.js";

function document(uri: string, text: string, version = 1): DocumentSnapshot {
  return Object.freeze({ uri, version, text, lineIndex: createUtf16LineIndex(text) });
}

describe("instance-local bounded syntax cache", () => {
  it.each([
    '"🚀"\r\n + 1',
    'data.\r\n + "unterminated',
    `price${" + 1".repeat(40)}`,
    " ".repeat(65_536),
  ])("matches the full uncached recovery CST, tokens and diagnostics", (text) => {
    const cache = new SyntaxParseCache();
    const snapshot = document("memory:///x", text);
    const cached = cache.get(snapshot);
    expect(cached).toEqual(parseKaladaV1Expression(text));
    expect(Object.isFrozen(cached.document.tokens)).toBe(true);
    expect(cache.get(snapshot)).toBe(cached);
    expect(new SyntaxParseCache().get(snapshot)).not.toBe(cached);
  });

  it("evicts on version, explicit close, large admission and the aggregate budget", () => {
    const cache = new SyntaxParseCache();
    const first = document("memory:///same", "1");
    const original = cache.get(first);
    expect(cache.get(document(first.uri, "2", 2))).toEqual(parseKaladaV1Expression("2"));
    expect(cache.get(first)).not.toBe(original);
    cache.forget(first.uri);
    expect(cache.get(first)).not.toBe(original);
    const large = document("memory:///large", " ".repeat(200_000));
    expect(cache.get(large)).not.toBe(cache.get(large));
    const retained = document("memory:///old", "7");
    const previous = cache.get(retained);
    for (let index = 0; index < 64; index += 1) {
      cache.get(document(`memory:///next-${index}`, "1"));
    }
    expect(cache.snapshot().evictions).toBeGreaterThan(0);
    expect(cache.snapshot().entries).toBeLessThanOrEqual(64);
    expect(cache.get(retained)).not.toBe(previous);
    const bounded = new SyntaxParseCache();
    for (let index = 0; index < 3; index += 1) {
      bounded.get(document(`memory:///large-${index}`, "1".repeat(65_535)));
    }
    expect(bounded.snapshot()).toMatchObject({ entries: 1, evictions: 2 });
    expect(bounded.snapshot().estimatedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("admits 50 independent token-heavy documents without a capacity eviction", () => {
    const cache = new SyntaxParseCache();
    const inputs = Array.from({ length: 50 }, (_, index) =>
      document(`memory:///expr-${index}`, `1${" + 1".repeat(40)} + ${index}`),
    );
    const results = inputs.map((input) => cache.get(input));
    inputs.forEach((input, index) => {
      expect(cache.get(input)).toBe(results[index]);
    });
    expect(cache.snapshot()).toMatchObject({ entries: 50, hits: 50, misses: 50, evictions: 0 });
    expect(cache.snapshot().estimatedBytes).toBeLessThan(2 * 1024 * 1024);
  });
});

import { describe, expect, it } from "vitest";
import {
  lowerKaladaV1Expression,
  experimentalParseKaladaV1GuestExpressionPrefix as parseGuestExpressionPrefix,
  parseKaladaV1Expression,
} from "../index.js";

// Test-only host declares the slot; it never searches the guest interior for a brace.
function host(
  source: string,
  start: number,
  options?: Parameters<typeof parseGuestExpressionPrefix>[2],
) {
  const result = parseGuestExpressionPrefix(source, start, options);
  if (!result.ok || source[result.stop] !== "}") return { result, rest: null };
  return { result, rest: source.slice(result.stop + 1) };
}

describe("experimental guest-owned boundary", () => {
  it.each([
    ['host{"}"}TAIL', 5, '"}"', "TAIL"],
    ['host{("}" + 1)}\r\n🚀TAIL', 5, '("}" + 1)', "\r\n🚀TAIL"],
    ["🚀{a ? (b + 1) : c}TAIL", 3, "a ? (b + 1) : c", "TAIL"],
    ["🚀{(1 + 2) * 3}TAIL", 3, "(1 + 2) * 3", "TAIL"],
    ['{a?.field ?? "\\"}\\""}TAIL', 1, 'a?.field ?? "\\"}\\""', "TAIL"],
    ['{"// } /*" + a}TAIL', 1, '"// } /*" + a', "TAIL"],
    ['{"\u0027`}"}TAIL', 1, '"\u0027`}"', "TAIL"],
  ])("hands off %s without consuming host tail", (source, start, expression, rest) => {
    const { result, rest: continuation } = host(source, start);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("outer-brace");
    expect(result.range).toEqual({ start, end: start + expression.length });
    expect(result.stop).toBe(start + expression.length);
    expect(continuation).toBe(rest);
    expect(result.diagnostics).toEqual([]);
    const parsed = result.parsed;
    expect(parsed?.document.source).toBe(source);
    expect(
      parsed?.document.tokens
        .slice(0, -1)
        .map((token) => token.text)
        .join(""),
    ).toBe(expression);
    expect(parsed?.document.tokens.at(-1)?.range).toEqual({ start: result.stop, end: result.stop });
    const standalone = parseKaladaV1Expression(expression);
    expect(parsed?.document.expression.kind).toBe(standalone.document.expression.kind);
    if (parsed) {
      const lowered = lowerKaladaV1Expression(parsed);
      const baseline = lowerKaladaV1Expression(standalone);
      expect(lowered.ok).toBe(baseline.ok);
      if (lowered.ok && baseline.ok) {
        expect(lowered.program).toEqual(baseline.program);
        expect(lowered.sourceMap.map((entry) => entry.range)).toEqual(
          baseline.sourceMap.map((entry) => ({
            start: entry.range.start + start,
            end: entry.range.end + start,
          })),
        );
      }
    }
  });

  it.each([
    ["{}tail", "KALADA_SYNTAX_EXPECTED_EXPRESSION"],
    ["{a b}tail", "KALADA_SYNTAX_UNEXPECTED_TOKEN"],
    ["{(a}tail", "KALADA_SYNTAX_EXPECTED_RIGHT_PARENTHESIS"],
    ['{"unterminated}tail', "KALADA_SYNTAX_INVALID_STRING"],
    ["{a //comment}tail", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
    ["{a /* } */}tail", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
    ["{{a}tail", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
    ["{a[0]}tail", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
    ["{a)}tail", "KALADA_SYNTAX_UNEXPECTED_TOKEN"],
  ])("fails closed for %s", (source, code) => {
    const { result, rest } = host(source, 1);
    expect(result.ok).toBe(false);
    expect(rest).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
    expect(result.diagnostics.every((item) => item.range.end <= result.stop)).toBe(true);
  });

  it.each(["//", "/*"])("stops at the %s opener without reading host tail", (comment) => {
    const prefix = `🚀{a ${comment}`;
    const opener = prefix.length - comment.length;
    const source = `${prefix}}${"TAIL🚀}".repeat(1000)}`;
    const { result, rest } = host(source, 3, { limits: { maxSourceLength: 16 } });
    expect(result).toMatchObject({ ok: false, reason: "unsupported-comment", stop: opener });
    expect(rest).toBeNull();
    expect(result.range).toEqual({ start: 3, end: opener });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KALADA_SYNTAX_UNSUPPORTED_FORM",
        range: { start: opener, end: opener },
      }),
    );
    expect(result.diagnostics.every((item) => item.range.end <= opener)).toBe(true);
    expect(result.parsed?.document.tokens.map((item) => item.text).join("")).toBe("a ");
    expect(result.parsed?.document.tokens.at(-1)?.range).toEqual({ start: opener, end: opener });
    expect(result.diagnostics.map((item) => item.code)).not.toContain(
      "KALADA_SYNTAX_LIMIT_EXCEEDED",
    );
  });

  it.each(["'", "`"])("stops at the unsupported %s opener before the host brace", (quote) => {
    const prefix = `🚀{a + ${quote}`;
    const opener = prefix.length - 1;
    const source = `${prefix}bad}TAIL${"🚀}".repeat(1000)}`;
    const { result, rest } = host(source, 3, { limits: { maxSourceLength: 16 } });
    expect(result).toMatchObject({ ok: false, reason: "unsupported-quote", stop: opener });
    expect(rest).toBeNull();
    expect(result.range).toEqual({ start: 3, end: opener });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KALADA_SYNTAX_UNSUPPORTED_FORM",
        range: { start: opener, end: opener },
      }),
    );
    expect(result.diagnostics.every((item) => item.range.end <= opener)).toBe(true);
    expect(result.parsed?.document.tokens.map((item) => item.text).join("")).toBe("a + ");
    expect(result.parsed?.document.tokens.at(-1)?.range).toEqual({
      start: opener,
      end: opener,
    });
    expect(result.diagnostics.map((item) => item.code)).not.toContain(
      "KALADA_SYNTAX_LIMIT_EXCEEDED",
    );
  });

  it.each(["'", "`"])("does not scan a %s body past a host brace", (quote) => {
    const source = `{${quote}bad}TAIL`;
    const result = parseGuestExpressionPrefix(source, 1);
    expect(result).toMatchObject({ ok: false, reason: "unsupported-quote", stop: 1 });
    expect(result.range).toEqual({ start: 1, end: 1 });
    expect(result.parsed?.document.tokens).toEqual([
      expect.objectContaining({ kind: "eof", range: { start: 1, end: 1 } }),
    ]);
    expect(result.diagnostics.every((item) => item.range.end <= 1)).toBe(true);
  });

  it("preserves whole-expression comment scanning outside the guest seam", () => {
    const source = "a //comment}TAIL";
    const parsed = parseKaladaV1Expression(source);
    expect(parsed.document.tokens).toContainEqual(
      expect.objectContaining({ kind: "unsupported", text: "//comment}TAIL" }),
    );
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KALADA_SYNTAX_UNSUPPORTED_FORM",
        range: { start: 2, end: source.length },
      }),
    );
  });

  it.each(["'", "`"])("preserves whole-expression %s scanning", (quote) => {
    const source = `${quote}bad}TAIL`;
    const parsed = parseKaladaV1Expression(source);
    expect(parsed.document.tokens).toContainEqual(
      expect.objectContaining({ kind: "unsupported", text: source }),
    );
  });

  it.each([
    ["{(a}TAIL", "KALADA_SYNTAX_EXPECTED_RIGHT_PARENTHESIS"],
    ["{a)}TAIL", "KALADA_SYNTAX_UNEXPECTED_TOKEN"],
  ])("stops at the host brace with unmatched parentheses in %s", (prefix, code) => {
    const source = `${prefix}${"tail".repeat(1000)}`;
    const boundary = prefix.indexOf("}");
    const result = parseGuestExpressionPrefix(source, 1, { limits: { maxSourceLength: 16 } });
    expect(result).toMatchObject({ ok: false, reason: "unmatched-parentheses", stop: boundary });
    expect(result.range).toEqual({ start: 1, end: boundary });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code, range: expect.objectContaining({ end: boundary }) }),
    );
    expect(result.diagnostics.every((item) => item.range.end <= boundary)).toBe(true);
    expect(Math.max(...(result.parsed?.document.tokens.map((item) => item.range.end) ?? []))).toBe(
      boundary,
    );
    expect(result.parsed?.document.tokens.at(-1)?.range).toEqual({
      start: boundary,
      end: boundary,
    });
    expect(result.diagnostics.map((item) => item.code)).not.toContain(
      "KALADA_SYNTAX_LIMIT_EXCEEDED",
    );
    expect(source.slice(result.stop + 1)).toBe(source.slice(boundary + 1));
  });

  it("reports missing close, bounded budget and invalid starts without success", () => {
    expect(host("{a + 1", 1).result).toMatchObject({ ok: false, reason: "eof" });
    const source = `{${"a ".repeat(100)}TAIL}`;
    const { result, rest } = host(source, 1, { limits: { maxSourceLength: 8 } });
    expect(result).toMatchObject({ ok: false, reason: "limit" });
    expect(result.stop).toBeLessThanOrEqual(10);
    expect(result.diagnostics.map((item) => item.code)).toContain("KALADA_SYNTAX_LIMIT_EXCEEDED");
    expect(rest).toBeNull();
    expect(host("{a}tail", -1).result).toMatchObject({ ok: false, reason: "invalid-start" });
  });

  it("keeps diagnostics absolute and refuses token budget exhaustion", () => {
    const source = "🚀{a + }TAIL";
    const { result, rest } = host(source, 3);
    expect(rest).toBeNull();
    const stop = source.indexOf("}");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KALADA_SYNTAX_EXPECTED_EXPRESSION",
        range: { start: stop, end: stop },
      }),
    );
    const tokens = host("{a + b}TAIL", 1, { limits: { maxTokens: 2 } }).result;
    expect(tokens.ok).toBe(false);
    expect(tokens.reason).toBe("limit");
    expect(tokens.stop).toBeLessThan("{a + b}".length);
  });

  it.each([
    ["{abcdefghijklmnop}TAIL", 1, "abcdefghijklmnop", { maxIdentifierLength: 4 }],
    ['{"abc\\u0064ef}tail"}TAIL', 1, '"abc\\u0064ef}tail"', { maxDecodedStringLength: 4 }],
    ['🚀{"😀\\u0061}more"}TAIL', 3, '"😀\\u0061}more"', { maxDecodedStringLength: 2 }],
  ])("bounds guest lexical limit at the full token in %s", (source, start, text, limit) => {
    const result = parseGuestExpressionPrefix(source, start, { limits: limit });
    const end = start + text.length;
    expect(result).toMatchObject({ ok: false, reason: "limit", stop: end });
    expect(result.range).toEqual({ start, end });
    expect(result.parsed?.document.tokens[0]).toMatchObject({
      kind: "invalid",
      text,
      range: { start, end },
    });
    expect(result.parsed?.document.tokens.at(-1)?.range).toEqual({ start: end, end });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        phase: "lex",
        code: "KALADA_SYNTAX_LIMIT_EXCEEDED",
        range: { start, end },
      }),
    );
    expect(result.diagnostics.every((item) => item.range.end <= end)).toBe(true);
  });

  it("stops at a lexical limit even after an invalid number fills the diagnostic budget", () => {
    const source = "{01 abcdef}TAIL";
    const result = parseGuestExpressionPrefix(source, 1, {
      limits: { maxDiagnostics: 1, maxIdentifierLength: 2 },
    });
    expect(result).toMatchObject({ ok: false, reason: "limit", stop: 10 });
    expect(result.parsed?.document.tokens.map((item) => item.text)).toEqual([
      "01",
      " ",
      "abcdef",
      "",
    ]);
    expect(result.diagnostics.every((item) => item.range.end <= 10)).toBe(true);
  });

  it("does not mistake a malformed number for a new lexical limit", () => {
    const source = "{01 abc}TAIL";
    const result = parseGuestExpressionPrefix(source, 1);
    expect(result).toMatchObject({ ok: false, reason: "outer-brace", stop: 7 });
    expect(result.parsed?.document.tokens.map((item) => item.text)).toEqual(["01", " ", "abc", ""]);
    const capped = parseGuestExpressionPrefix(source, 1, { limits: { maxDiagnostics: 1 } });
    expect(capped.stop).toBe(7);
    expect(capped.parsed?.document.tokens.map((item) => item.text)).toEqual(["01", " ", "abc", ""]);
  });

  it("retains token and source-window budgets for overlong guest literals", () => {
    const source = "{abcdefghijklmnop}TAIL";
    expect(
      parseGuestExpressionPrefix(source, 1, {
        limits: { maxTokens: 1, maxIdentifierLength: 4 },
      }).stop,
    ).toBe(17);
    const windowed = parseGuestExpressionPrefix(source, 1, {
      limits: { maxSourceLength: 8, maxIdentifierLength: 4 },
    });
    expect(windowed).toMatchObject({ ok: false, reason: "limit" });
    expect(windowed.stop).toBeLessThanOrEqual(10);
    expect(windowed.diagnostics.every((item) => item.range.end <= 10)).toBe(true);
  });

  it.each([
    ["abcdefghijklmnop}TAIL", { maxIdentifierLength: 4 }],
    ['"abc\\u0064ef}tail"}TAIL', { maxDecodedStringLength: 4 }],
  ])("preserves whole-parser lexical remainder for %s", (source, limit) => {
    const parsed = parseKaladaV1Expression(source, { limits: limit });
    expect(parsed.document.tokens[0]).toMatchObject({
      kind: "invalid",
      text: source,
      range: { start: 0, end: source.length },
    });
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KALADA_SYNTAX_LIMIT_EXCEEDED",
        range: { start: 0, end: source.length },
      }),
    );
  });
});

import { describe, expect, it } from "vitest";
import { DiagnosticSink } from "../diagnostics.js";
import { freezeRange } from "../freeze.js";
import {
  DEFAULT_KALADA_SYNTAX_LIMITS,
  formatKaladaV1Expression,
  type KaladaBinaryCstNode,
  type KaladaCstNode,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "../index.js";

function binary(source: string): KaladaBinaryCstNode {
  const parsed = parseKaladaV1Expression(source);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.document.expression.kind).toBe("binary");
  return parsed.document.expression as KaladaBinaryCstNode;
}

function nestedTernary(count: number): string {
  return `${"a?".repeat(count)}a${":a".repeat(count)}`;
}

function expectSingleFrozenLimit(
  source: string,
  options?: Parameters<typeof parseKaladaV1Expression>[1],
) {
  const result = parseKaladaV1Expression(source, options);
  const limits = result.diagnostics.filter((item) => item.code === "KALADA_SYNTAX_LIMIT_EXCEEDED");
  expect(limits).toHaveLength(1);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.document.expression)).toBe(true);
  expect(Object.isFrozen(limits[0])).toBe(true);
  expect(
    result.document.tokens
      .slice(0, -1)
      .map((token) => token.text)
      .join(""),
  ).toBe(source);
  expect(result.document.expression).toMatchObject({ kind: "error", token: null });
  return result;
}

describe("lossless lexing and bounded recovery", () => {
  it("assigns every UTF-16 source unit to one non-EOF token", () => {
    const source = '\talpha?.xor + 1.20e+2 != "\\u0061"\r\n';
    const { document, diagnostics } = parseKaladaV1Expression(source);
    expect(diagnostics).toEqual([]);
    expect(
      document.tokens
        .slice(0, -1)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
    expect(document.tokens.at(-1)).toMatchObject({
      kind: "eof",
      range: { start: source.length, end: source.length },
    });
    for (let index = 1; index < document.tokens.length; index += 1) {
      expect(document.tokens[index]?.range.start).toBe(document.tokens[index - 1]?.range.end);
    }
  });

  it.each([
    ["01", "KALADA_SYNTAX_INVALID_NUMBER"],
    ["1.", "KALADA_SYNTAX_INVALID_NUMBER"],
    ["1e", "KALADA_SYNTAX_INVALID_NUMBER"],
    ["1e+", "KALADA_SYNTAX_INVALID_NUMBER"],
    ['"unterminated', "KALADA_SYNTAX_INVALID_STRING"],
    ['"\\x20"', "KALADA_SYNTAX_INVALID_STRING"],
    ["a === b", "KALADA_SYNTAX_UNSUPPORTED_OPERATOR"],
    ["a[0]", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
    ["a()", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
    ["// no", "KALADA_SYNTAX_UNSUPPORTED_FORM"],
  ])("diagnoses %s stably", (source, code) => {
    expect(parseKaladaV1Expression(source).diagnostics.map((item) => item.code)).toContain(code);
  });

  it("honors source, token, node, depth, diagnostic, and recovery limits", () => {
    expect(
      parseKaladaV1Expression("abc", { limits: { maxSourceLength: 2 } }).diagnostics,
    ).toHaveLength(1);
    expect(
      parseKaladaV1Expression("a b c", { limits: { maxTokens: 2 } }).diagnostics.map(
        (item) => item.code,
      ),
    ).toContain("KALADA_SYNTAX_LIMIT_EXCEEDED");
    expect(
      parseKaladaV1Expression("a+a+a", { limits: { maxCstNodes: 2 } }).diagnostics.map(
        (item) => item.code,
      ),
    ).toContain("KALADA_SYNTAX_LIMIT_EXCEEDED");
    expect(
      parseKaladaV1Expression("((((a))))", { limits: { maxCstDepth: 2 } }).diagnostics.map(
        (item) => item.code,
      ),
    ).toContain("KALADA_SYNTAX_LIMIT_EXCEEDED");
    expect(
      parseKaladaV1Expression("@ @ @", { limits: { maxDiagnostics: 1 } }).diagnostics,
    ).toMatchObject([{ code: "KALADA_SYNTAX_LIMIT_EXCEEDED" }]);
    expect(
      parseKaladaV1Expression("a b c", { limits: { maxRecoveryTokens: 1 } }).diagnostics.map(
        (item) => item.code,
      ),
    ).toContain("KALADA_SYNTAX_LIMIT_EXCEEDED");
  });

  it("stops at identifier and decoded-string limit boundaries", () => {
    expect(
      parseKaladaV1Expression("abc", { limits: { maxIdentifierLength: 3 } }).diagnostics,
    ).toEqual([]);
    const identifierSource = "a + four + later";
    const identifier = parseKaladaV1Expression(identifierSource, {
      limits: { maxIdentifierLength: 3 },
    });
    expectLexicalRemainder(identifierSource, identifier, 4);

    expect(
      parseKaladaV1Expression('"a"', { limits: { maxDecodedStringLength: 1 } }).diagnostics,
    ).toEqual([]);
    const stringSource = '"aa" + "bb"';
    const string = parseKaladaV1Expression(stringSource, {
      limits: { maxDecodedStringLength: 1 },
    });
    expectLexicalRemainder(stringSource, string, 0);
  });

  it("returns invalid-input diagnostics for hostile and invalid options", () => {
    const hostile = Object.defineProperty({}, "limits", {
      get: () => {
        throw new Error("no");
      },
    });
    expect(parseKaladaV1Expression("a", hostile).diagnostics[0]?.code).toBe(
      "KALADA_SYNTAX_INVALID_INPUT",
    );
    expect(parseKaladaV1Expression("a", { limits: { maxTokens: 0 } }).diagnostics[0]?.code).toBe(
      "KALADA_SYNTAX_INVALID_INPUT",
    );
    expect(parseKaladaV1Expression(1 as never).diagnostics[0]?.code).toBe(
      "KALADA_SYNTAX_INVALID_INPUT",
    );
  });

  it("accepts the exact group, unary, and ternary depth boundary", () => {
    expect(parseKaladaV1Expression(`${"(".repeat(63)}a${")".repeat(63)}`).diagnostics).toEqual([]);
    expect(parseKaladaV1Expression(`${"!".repeat(63)}a`).diagnostics).toEqual([]);
    expect(parseKaladaV1Expression(nestedTernary(63)).diagnostics).toEqual([]);
  });

  it("stops before descending beyond each recursive depth boundary", () => {
    for (const source of [
      `${"(".repeat(64)}a${")".repeat(64)}`,
      `${"!".repeat(64)}a`,
      nestedTernary(64),
    ]) {
      const result = expectSingleFrozenLimit(source);
      expect(result.document.expression.range.end).toBe(source.length);
    }
  });

  it("returns for the Auditor nested-group reproduction without exhausting the host stack", () => {
    const source = `${"(".repeat(15_000)}a${")".repeat(15_000)}`;
    for (const options of [undefined, { limits: { maxTokens: 50_000 } }]) {
      const result = expectSingleFrozenLimit(source, options);
      expect(result.diagnostics).toMatchObject([
        { phase: "parse", range: { start: 64, end: source.length } },
      ]);
      expect(result.document.expression.range).toEqual({ start: 64, end: source.length });
    }
  });

  it("keeps the earliest limit and gives an equal lexical boundary deterministic precedence", () => {
    const sink = new DiagnosticSink(DEFAULT_KALADA_SYNTAX_LIMITS);
    sink.limit("lex", freezeRange(4, 20));
    sink.limit("parse", freezeRange(4, 20));
    sink.limit("parse", freezeRange(5, 20));
    expect(sink.diagnostics).toMatchObject([{ phase: "lex", range: { start: 4, end: 20 } }]);
    sink.limit("parse", freezeRange(3, 20));
    expect(sink.diagnostics).toMatchObject([{ phase: "parse", range: { start: 3, end: 20 } }]);
    expect(sink.diagnostics).toHaveLength(1);
  });

  it("returns for extreme nested unary and ternary input", () => {
    expectSingleFrozenLimit(`${"!".repeat(15_000)}a`);
    expectSingleFrozenLimit(nestedTernary(5_000), { limits: { maxTokens: 50_000 } });
  });

  it("enforces node and recovery boundaries before consuming over budget", () => {
    const nodeLimited = expectSingleFrozenLimit("a+a", { limits: { maxCstNodes: 1 } });
    expect(nodeLimited.document.expression.range).toEqual({ start: 2, end: 3 });
    const recoveryLimited = expectSingleFrozenLimit("a b c", {
      limits: { maxRecoveryTokens: 1 },
    });
    expect(recoveryLimited.document.expression.range).toEqual({ start: 4, end: 5 });
  });

  it("does not let malformed recursive mixes bypass any counter", () => {
    const source = `${"(".repeat(500)}${"!".repeat(500)}a?${"(".repeat(500)}b:c`;
    const result = expectSingleFrozenLimit(source, {
      limits: { maxCstDepth: 16, maxCstNodes: 32, maxRecoveryTokens: 8 },
    });
    expect(result.diagnostics.length).toBeLessThanOrEqual(2);
  });
});

describe("precedence, associativity, and restrictions", () => {
  it.each([
    ["a+b*c", "+", "*"],
    ["a<b+c", "<", "+"],
    ["a==b<c", "==", "<"],
    ["a&&b==c", "&&", "=="],
    ["a xor b&&c", "xor", "&&"],
    ["a||b xor c", "||", "xor"],
  ])("parses %s using the ADR tiers", (source, outer, inner) => {
    const node = binary(source);
    expect(node.operator).toBe(outer);
    expect(node.right).toMatchObject({ kind: "binary", operator: inner });
  });

  it("associates every binary tier left", () => {
    for (const operator of ["*", "+", "==", "&&", "xor", "||", "??"] as const) {
      const node = binary(`a ${operator} b ${operator} c`);
      expect(node.left).toMatchObject({ kind: "binary", operator });
    }
  });

  it("associates unary and ternary expressions right", () => {
    expect(parseKaladaV1Expression("!-a").document.expression).toMatchObject({
      kind: "unary",
      operand: { kind: "unary" },
    });
    expect(parseKaladaV1Expression("a ? b : c ? d : e").document.expression).toMatchObject({
      kind: "conditional",
      else: { kind: "conditional" },
    });
  });

  it.each(["a < b < c", "a in b >= c", "a > b in c"])(
    "rejects unparenthesized relational chain %s",
    (source) => {
      expect(parseKaladaV1Expression(source).diagnostics.map((item) => item.code)).toContain(
        "KALADA_SYNTAX_RELATIONAL_CHAIN",
      );
    },
  );

  it.each(["a ?? b || c", "a || b ?? c", "a ?? b xor c && d", "a && b xor c ?? d"])(
    "rejects coalesce/logical mix %s",
    (source) => {
      expect(parseKaladaV1Expression(source).diagnostics.map((item) => item.code)).toContain(
        "KALADA_SYNTAX_COALESCE_LOGICAL_MIX",
      );
    },
  );

  it.each(["(a ?? b) || c", "a ?? (b || c)", "(a < b) < c", "a < (b < c)"])(
    "allows explicit grouping in %s",
    (source) => {
      expect(parseKaladaV1Expression(source).diagnostics).toEqual([]);
    },
  );

  it("treats in and xor as contextual field names only", () => {
    expect(parseKaladaV1Expression("value.in?.xor").diagnostics).toEqual([]);
    expect(parseKaladaV1Expression("in").diagnostics.map((item) => item.code)).toContain(
      "KALADA_SYNTAX_EXPECTED_EXPRESSION",
    );
  });
});

describe("formatting", () => {
  it("preserves spellings and all groups while normalizing spaces", () => {
    const source = ' ((a?.in))+1.0e1* - "\\u0061" ';
    const formatted = formatKaladaV1Expression(source);
    expect(formatted).toEqual({ ok: true, text: '((a?.in)) + 1.0e1 * -"\\u0061"' });
    if (formatted.ok) expect(formatKaladaV1Expression(formatted.text)).toEqual(formatted);
  });

  it("rejects invalid input instead of formatting recovery", () => {
    const outcome = formatKaladaV1Expression("a +");
    expect(outcome.ok).toBe(false);
  });

  it.each([
    ["+ +1", "+ +1", undefined],
    ["- -1", "- -1", undefined],
    ["+ +a", "+ +a", "number"],
    ["- -a", "- -a", "number"],
    ["!- -1", "!- -1", undefined],
    ["+ + +1", "+ + +1", undefined],
    ["- - -a", "- - -a", "number"],
    ["+ -1", "+-1", undefined],
    ["- +1", "-+1", undefined],
    ["! !a", "!!a", "boolean"],
    ["! +a", "!+a", "number"],
    ["! -a", "!-a", "number"],
    ["+ + - -1", "+ +- -1", undefined],
    ["+(+1)", "+(+1)", undefined],
  ] as const)("formats unary chain %s without changing meaning", (source, expected, name) => {
    const options = name
      ? { references: { a: { reference: "a", type: { kind: "primitive-type" as const, name } } } }
      : undefined;
    const parsed = parseKaladaV1Expression(source);
    expect(parsed.diagnostics).toEqual([]);
    const formatted = formatKaladaV1Expression(source);
    expect(formatted).toEqual({ ok: true, text: expected });
    if (!formatted.ok) return;
    const reparsed = parseKaladaV1Expression(formatted.text);
    expect(reparsed.diagnostics).toEqual([]);
    expect(unaryStructure(reparsed.document.expression)).toEqual(
      unaryStructure(parsed.document.expression),
    );
    expect(formatKaladaV1Expression(formatted.text)).toEqual(formatted);
    expectEquivalentLowering(parsed, reparsed, options);
  });

  it.each(["++1", "--1", "++a", "--a"])("does not repair unsupported unary source %s", (source) => {
    expect(parseKaladaV1Expression(source).diagnostics.map((item) => item.code)).toContain(
      "KALADA_SYNTAX_UNSUPPORTED_OPERATOR",
    );
    expect(formatKaladaV1Expression(source).ok).toBe(false);
  });

  it.each([
    ["1.field", "1.field"],
    ["1 .field", "1.field"],
    ["1.0.field", "1.0.field"],
    ["1.0 .field", "1.0.field"],
    ["1e2.field", "1e2.field"],
    ["1e2 .field", "1e2.field"],
  ])("keeps numeric navigation stable for %s", (source, expected) => {
    const parsed = parseKaladaV1Expression(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.expression).toMatchObject({
      kind: "field-access",
      target: { kind: "literal", value: expect.any(Number) },
      field: "field",
    });
    expect(lowerKaladaV1Expression(parsed)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_FIELD_TYPE_MISMATCH" }],
    });
    const formatted = formatKaladaV1Expression(source);
    expect(formatted).toEqual({ ok: true, text: expected });
    expect(parseKaladaV1Expression(expected).diagnostics).toEqual([]);
    expect(formatKaladaV1Expression(expected)).toEqual(formatted);
  });
});

function unaryStructure(node: KaladaCstNode): unknown {
  if (node.kind === "unary") {
    return { kind: node.kind, operator: node.operator, operand: unaryStructure(node.operand) };
  }
  if (node.kind === "group") {
    return { kind: node.kind, expression: unaryStructure(node.expression) };
  }
  if (node.kind === "literal") {
    return { kind: node.kind, literalKind: node.literalKind, value: node.value };
  }
  if (node.kind === "reference") return { kind: node.kind, name: node.name };
  return { kind: node.kind };
}

function expectEquivalentLowering(
  source: ReturnType<typeof parseKaladaV1Expression>,
  formatted: ReturnType<typeof parseKaladaV1Expression>,
  options?: Parameters<typeof lowerKaladaV1Expression>[1],
): void {
  const sourceOutcome = lowerKaladaV1Expression(source, options);
  const formattedOutcome = lowerKaladaV1Expression(formatted, options);
  expect(formattedOutcome.ok).toBe(sourceOutcome.ok);
  if (sourceOutcome.ok && formattedOutcome.ok) {
    expect(formattedOutcome.program).toEqual(sourceOutcome.program);
    return;
  }
  if (!sourceOutcome.ok && !formattedOutcome.ok) {
    const stable = (item: (typeof sourceOutcome.diagnostics)[number]) => ({
      code: item.code,
      path: item.path,
    });
    expect(formattedOutcome.diagnostics.map(stable)).toEqual(sourceOutcome.diagnostics.map(stable));
  }
}

function expectLexicalRemainder(
  source: string,
  result: ReturnType<typeof parseKaladaV1Expression>,
  start: number,
): void {
  expect(result.diagnostics).toMatchObject([
    {
      phase: "lex",
      code: "KALADA_SYNTAX_LIMIT_EXCEEDED",
      range: { start, end: source.length },
    },
  ]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.document.tokens.filter((item) => item.kind === "invalid")).toMatchObject([
    { text: source.slice(start), range: { start, end: source.length } },
  ]);
  expect(result.document.expression).toMatchObject({
    kind: "error",
    token: null,
    range: { start, end: source.length },
  });
  expect(result.document.tokens.map((item) => item.text).join("")).toBe(source);
}

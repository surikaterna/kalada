import {
  compileKaladaV1Program,
  type KaladaType,
  type KaladaV1Options,
  Option,
} from "@kalada/core";
import { describe, expect, it } from "vitest";
import { lowerKaladaV1Expression, parseKaladaV1Expression } from "../index.js";

const type = (
  name: "null" | "boolean" | "number" | "string" | "json" | "Instant" | "Duration",
): KaladaType => ({ kind: "primitive-type", name });
const domains = ["dynamic", "number", "string", "Instant", "Duration", "boolean"] as const;
type Domain = (typeof domains)[number];
const orderedDomains: readonly Domain[] = ["number", "string", "Instant", "Duration"];
const arithmeticPairs = {
  "+": new Set([
    "number/number",
    "number/dynamic",
    "Instant/Duration",
    "Instant/dynamic",
    "Duration/Duration",
    "Duration/dynamic",
    "dynamic/number",
    "dynamic/Duration",
  ]),
  "-": new Set([
    "number/number",
    "number/dynamic",
    "Instant/Instant",
    "Instant/Duration",
    "Instant/dynamic",
    "Duration/Duration",
    "Duration/dynamic",
    "dynamic/number",
    "dynamic/Instant",
    "dynamic/Duration",
  ]),
} as const;

function lower(source: string, types: Readonly<Record<string, KaladaType | "dynamic">> = {}) {
  const references = Object.fromEntries(
    Object.entries(types).map(([name, found]) => [name, { reference: name, type: found }]),
  );
  return lowerKaladaV1Expression(parseKaladaV1Expression(source), { references });
}

function expectSuccessfulLoweringRecompiles(
  source: string,
  types: Readonly<Record<string, KaladaType | "dynamic">>,
  coreOptions: KaladaV1Options<string>,
): void {
  const references = Object.fromEntries(
    Object.entries(types).map(([name, found]) => [name, { reference: name, type: found }]),
  );
  const outcome = lowerKaladaV1Expression(parseKaladaV1Expression(source), {
    references,
    coreOptions,
  });
  expect(outcome.ok, source).toBe(true);
  if (!outcome.ok) return;
  const recompiled = compileKaladaV1Program(outcome.program, coreOptions);
  expect(recompiled.ok, source).toBe(true);
  if (recompiled.ok) expect(recompiled.value.program).toEqual(outcome.program);
}

function nestedArrayType(nodes: number): KaladaType {
  let result = type("number");
  for (let depth = 1; depth < nodes; depth += 1) result = { kind: "array-type", element: result };
  return result;
}

function sourceType(domain: Domain): KaladaType | "dynamic" {
  return domain === "dynamic" ? domain : type(domain);
}

function checkOrderedPair(left: Domain, right: Domain): void {
  const outcome = lower("left < right", { left: sourceType(left), right: sourceType(right) });
  const sameDomain = left === right && orderedDomains.includes(left);
  const oneDynamic = (left === "dynamic") !== (right === "dynamic");
  const selected = oneDynamic && [left, right].some((item) => orderedDomains.includes(item));
  expect(outcome.ok, `${left} < ${right}`).toBe(sameDomain || selected);
}

function checkArithmeticPair(operator: "+" | "-", left: Domain, right: Domain): void {
  const outcome = lower(`left ${operator} right`, {
    left: sourceType(left),
    right: sourceType(right),
  });
  expect(outcome.ok, `${left} ${operator} ${right}`).toBe(
    arithmeticPairs[operator].has(`${left}/${right}`),
  );
}

describe("static dispatch", () => {
  it.each([
    ["n+n", { n: type("number") }, "numeric-binary"],
    ["i+d", { i: type("Instant"), d: type("Duration") }, "temporal-arithmetic"],
    ["d+d", { d: type("Duration") }, "temporal-arithmetic"],
    ["n<s", { n: type("number"), s: "dynamic" }, "ordered-comparison"],
    ["s<s", { s: type("string") }, "ordered-comparison"],
    ["i<d", { i: type("Instant"), d: type("Instant") }, "temporal-comparison"],
    [
      "n in a",
      { n: type("number"), a: { kind: "array-type", element: type("string") } },
      "membership",
    ],
    ["b&&x", { b: type("boolean"), x: "dynamic" }, "boolean-logical"],
  ] as const)("selects the canonical family for %s", (source, types, kind) => {
    const outcome = lower(source, types);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.program.expression.kind).toBe(kind);
  });

  it.each([
    ["a+a", { a: "dynamic" }, "KALADA_OPERATOR_AMBIGUOUS"],
    ["a<a", { a: "dynamic" }, "KALADA_OPERATOR_AMBIGUOUS"],
    ["s+1", { s: type("string") }, "KALADA_OPERATOR_TYPE"],
    ["i+i", { i: type("Instant") }, "KALADA_OPERATOR_TYPE"],
    ["d-i", { d: type("Duration"), i: type("Instant") }, "KALADA_OPERATOR_TYPE"],
    ["1 in n", { n: type("number") }, "KALADA_OPERATOR_TYPE"],
    ["1&&true", {}, "KALADA_OPERATOR_TYPE"],
    ["null.field", {}, "KALADA_FIELD_TYPE_MISMATCH"],
    ["1??2", {}, "KALADA_OPTION_REQUIRED"],
  ] as const)("rejects invalid dispatch for %s", (source, types, code) => {
    const outcome = lower(source, types);
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code }] });
  });

  it("implements conditional joins without synthesizing unions", () => {
    expect(lower("c ? 1 : null", { c: type("boolean") }).ok).toBe(true);
    expect(
      lower("c ? i : d", { c: type("boolean"), i: type("Instant"), d: type("Duration") }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_OPERATOR_TYPE", path: ["expression", "else"] }],
    });
  });

  it("accepts strict and one-layer optional navigation domains", () => {
    expect(lower("j.field", { j: type("json") }).ok).toBe(true);
    expect(lower("n?.field", { n: type("null") }).ok).toBe(true);
    expect(lower("o?.field", { o: { kind: "option-type", value: type("json") } }).ok).toBe(true);
    expect(
      lower("o?.field", {
        o: { kind: "option-type", value: { kind: "option-type", value: type("json") } },
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: "KALADA_FIELD_TYPE_MISMATCH" }] });
  });

  it("covers every ordered domain pair", () => {
    for (const left of domains) {
      for (const right of domains) checkOrderedPair(left, right);
    }
  });

  it("covers every additive and subtractive domain pair", () => {
    for (const operator of ["+", "-"] as const) {
      for (const left of domains) {
        for (const right of domains) checkArithmeticPair(operator, left, right);
      }
    }
  });
});

describe("canonical lowering and maps", () => {
  it("recompiles every representative successful lowering with identical core options", () => {
    const coreOptions: KaladaV1Options<string> = {};
    const fixtures = [
      ["1 + 2", {}],
      ["n < d", { n: type("number"), d: "dynamic" }],
      ["s < d", { s: type("string"), d: "dynamic" }],
      ["i < j", { i: type("Instant"), j: type("Instant") }],
      ["i + d", { i: type("Instant"), d: type("Duration") }],
    ] as const;
    for (const [source, types] of fixtures) {
      expectSuccessfulLoweringRecompiles(source, types, coreOptions);
    }
  });

  it("counts the root static type node at depth one", () => {
    const lowerAtDepth = (nodes: number, maximum: number) => {
      const parsed = parseKaladaV1Expression("item", {
        limits: { maxStaticTypeDepth: maximum },
      });
      return lowerKaladaV1Expression(parsed, {
        references: { item: { reference: "item", type: nestedArrayType(nodes) } },
      });
    };
    expect(lowerAtDepth(1, 1).ok).toBe(true);
    expect(lowerAtDepth(2, 1)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_INVALID_INPUT" }],
    });
    expect(lowerAtDepth(64, 64).ok).toBe(true);
    expect(lowerAtDepth(65, 64).ok).toBe(false);
    expect(lowerAtDepth(256, 256).ok).toBe(true);
    expect(lowerAtDepth(257, 256).ok).toBe(false);
  });

  it("lowers coalesce directly and retains lazy core behavior", () => {
    const outcome = lowerKaladaV1Expression(parseKaladaV1Expression("option ?? fallback"), {
      references: {
        option: { reference: "option", type: { kind: "option-type", value: type("number") } },
        fallback: { reference: "fallback", type: type("number") },
      },
    });
    expect(outcome).toMatchObject({
      ok: true,
      program: {
        expression: { kind: "option-coalesce", option: { kind: "ref" }, fallback: { kind: "ref" } },
      },
    });
    if (!outcome.ok) return;
    const compiled = compileKaladaV1Program(outcome.program);
    expect(compiled.ok).toBe(true);
    let fallbackCalls = 0;
    if (compiled.ok) {
      const evaluated = compiled.value.evaluate((reference) => {
        if (reference === "option") return { found: true, value: Option.some(0) };
        fallbackCalls += 1;
        return { found: true, value: 9 };
      });
      expect(evaluated).toEqual({ ok: true, value: 0 });
      expect(fallbackCalls).toBe(0);
    }
  });

  it("maps nodes, operands, operators, fields, literals, references, and groups", () => {
    const source = "(j?.field == 1)";
    const outcome = lower(source, { j: type("json") });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sourceMap.map((entry) => entry.role)).toEqual(
      expect.arrayContaining(["node", "operator", "field", "literal", "reference", "group"]),
    );
    expect(outcome.sourceMap.find((entry) => entry.role === "group")?.range).toEqual({
      start: 0,
      end: source.length,
    });
    expect(
      outcome.sourceMap.find((entry) => entry.role === "node" && entry.path.length === 1)?.range,
    ).toEqual({ start: 0, end: source.length });
  });

  it("maps static diagnostics to the precise operand or operator", () => {
    expect(lower("1 + true")).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "KALADA_OPERATOR_TYPE",
          range: { start: 4, end: 8 },
          path: ["expression", "right"],
        },
      ],
    });
    expect(lower("a + b", { a: "dynamic", b: "dynamic" })).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "KALADA_OPERATOR_AMBIGUOUS",
          range: { start: 2, end: 3 },
          path: ["expression", "operator"],
        },
      ],
    });
  });

  it("requires compatible codecs for structured references", () => {
    const parsed = parseKaladaV1Expression("item");
    const failed = lowerKaladaV1Expression<{ id: string }>(parsed, {
      references: { item: { reference: { id: "x" }, type: "dynamic" } },
    });
    expect(failed).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_INVALID_REFERENCE" }],
    });
    const passed = lowerKaladaV1Expression<{ id: string }>(parsed, {
      references: { item: { reference: { id: "x" }, type: "dynamic" } },
      coreOptions: {
        reference: {
          validate: (value): value is { id: string } =>
            typeof value === "object" &&
            value !== null &&
            Object.getOwnPropertyDescriptor(value, "id")?.value === "x",
        },
      },
    });
    expect(passed.ok).toBe(true);
  });
});

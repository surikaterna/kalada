import { expect, it } from "vitest";
import { canonicalizeKaladaV1Program, KaladaV1 } from "../index.js";

const literal = (value: null | boolean | number | string) => KaladaV1.literal(value);
const program = (expression: unknown) => ({
  format: "kalada-program",
  version: 1,
  profile: "kalada-v1",
  expression,
});

it("canonicalizes and deeply freezes every node", () => {
  const input = KaladaV1.program(
    KaladaV1.binding("x", literal(1), KaladaV1.Option.some(KaladaV1.ref("x"))),
  );
  const result = canonicalizeKaladaV1Program(input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.isFrozen(result.value.expression)).toBe(true);
});

it("sorts exhaustive arms in canonical Option and Result order", () => {
  const option = KaladaV1.match("Option", KaladaV1.Option.none(), [
    KaladaV1.arm("none", literal(0)),
    KaladaV1.arm("some", literal(1), "value"),
  ]);
  const result = canonicalizeKaladaV1Program(KaladaV1.program(option));
  expect(
    result.ok &&
      result.value.expression.kind === "match" &&
      result.value.expression.arms.map((arm) => arm.variant),
  ).toEqual(["some", "none"]);
});

it.each([
  [
    "missing",
    [KaladaV1.arm("some", literal(1))],
    "KALADA_MATCH_MISSING_ARM",
    ["expression", "arms"],
  ],
  [
    "duplicate",
    [KaladaV1.arm("some", literal(1)), KaladaV1.arm("some", literal(2))],
    "KALADA_MATCH_DUPLICATE_ARM",
    ["expression", "arms", 1, "variant"],
  ],
  [
    "unknown",
    [KaladaV1.arm("some", literal(1)), KaladaV1.arm("ok", literal(2))],
    "KALADA_MATCH_UNKNOWN_ARM",
    ["expression", "arms", 1, "variant"],
  ],
  [
    "unreachable",
    [
      KaladaV1.arm("some", literal(1)),
      KaladaV1.arm("none", literal(2)),
      KaladaV1.arm("none", literal(3)),
    ],
    "KALADA_MATCH_UNREACHABLE_ARM",
    ["expression", "arms", 2],
  ],
])("rejects %s match arms deterministically", (_name, arms, code, path) => {
  const result = canonicalizeKaladaV1Program(
    program(KaladaV1.match("Option", KaladaV1.Option.none(), arms as never)),
  );
  expect(result).toMatchObject({ ok: false, diagnostic: { code, path } });
});

it("rejects a binding on a payload-free arm", () => {
  const expression = {
    kind: "match",
    type: "Option",
    value: { kind: "option", variant: "none" },
    arms: [
      { variant: "some", binding: "x", body: literal(1) },
      { variant: "none", binding: "x", body: literal(0) },
    ],
  };
  expect(canonicalizeKaladaV1Program(program(expression))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "arms", 1, "binding"] },
  });
});

it("contains hostile keys, descriptors, proxies, cycles, and numeric inputs", () => {
  expect(
    canonicalizeKaladaV1Program(program({ kind: "literal", value: Number.POSITIVE_INFINITY })),
  ).toMatchObject({ ok: false });
  expect(canonicalizeKaladaV1Program(program({ kind: "literal", value: -0 }))).toMatchObject({
    ok: true,
    value: { expression: { value: 0 } },
  });
  const cycle: Record<string, unknown> = { kind: "option", variant: "some" };
  cycle.value = cycle;
  expect(canonicalizeKaladaV1Program(program(cycle))).toMatchObject({ ok: false });
  const getter = Object.defineProperty({ kind: "literal" }, "value", {
    enumerable: true,
    get: () => 1,
  });
  expect(canonicalizeKaladaV1Program(program(getter))).toMatchObject({ ok: false });
  expect(
    canonicalizeKaladaV1Program(
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("no");
          },
        },
      ),
    ),
  ).toMatchObject({ ok: false });
});

it("enforces configured structure and string limits", () => {
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(literal("xx")), {
      limits: { maxStringLength: 1 },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_LIMIT_EXCEEDED" } });
  const nested = KaladaV1.Option.some(KaladaV1.Option.some(literal(1)));
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(nested), { limits: { maxDepth: 1 } }),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_LIMIT_EXCEEDED" } });
});

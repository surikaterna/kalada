import { expect, it, vi } from "vitest";
import { compileKaladaV1Program, equalKaladaValues, KaladaV1, Option, Result } from "../index.js";

const literal = (value: null | boolean | number | string) => KaladaV1.literal(value);
const missing = () => ({ found: false as const });

it("evaluates constructors and exhaustive matches with payload bindings", () => {
  const expression = KaladaV1.match("Result", KaladaV1.Result.ok(literal(7)), [
    KaladaV1.arm("err", literal("error"), "problem"),
    KaladaV1.arm("ok", KaladaV1.Option.some(KaladaV1.ref("answer")), "answer"),
  ]);
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const output = compiled.value.evaluate(missing);
  expect(output.ok && equalKaladaValues(output.value, Option.some(7))).toBe(true);
});

it("uses exact lexical scope, shadowing, and non-recursive initializers", () => {
  const expression = KaladaV1.binding(
    "x",
    KaladaV1.ref("x"),
    KaladaV1.binding("x", literal("inner"), KaladaV1.ref("x")),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const resolve = vi.fn(() => ({ found: true as const, value: "outer" }));
  expect(compiled.ok && compiled.value.evaluate(resolve)).toMatchObject({
    ok: true,
    value: "inner",
  });
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("evaluates only the selected arm", () => {
  const expression = KaladaV1.match("Option", KaladaV1.Option.none(), [
    KaladaV1.arm("some", KaladaV1.ref("unselected"), "value"),
    KaladaV1.arm("none", literal("selected")),
  ]);
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const resolve = vi.fn(missing);
  expect(compiled.ok && compiled.value.evaluate(resolve)).toMatchObject({
    ok: true,
    value: "selected",
  });
  expect(resolve).not.toHaveBeenCalled();
});

it("reports runtime match type mismatch at the scrutinee", () => {
  const expression = KaladaV1.match("Option", literal(false), [
    KaladaV1.arm("some", literal(1), "value"),
    KaladaV1.arm("none", literal(0)),
  ]);
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  expect(compiled.ok && compiled.value.evaluate(missing)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_MATCH_TYPE_MISMATCH", path: ["expression", "value"] },
  });
});

it("charges each evaluated node with an exact inclusive boundary", () => {
  const expression = KaladaV1.Option.some(literal(1));
  const pass = compileKaladaV1Program(KaladaV1.program(expression), {
    limits: { maxEvaluationSteps: 2 },
  });
  const fail = compileKaladaV1Program(KaladaV1.program(expression), {
    limits: { maxEvaluationSteps: 1 },
  });
  expect(pass.ok && pass.value.evaluate(missing)).toMatchObject({ ok: true });
  expect(fail.ok && fail.value.evaluate(missing)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression", "value"] },
  });
});

it.each([
  [{ found: false }, "KALADA_REFERENCE_MISSING"],
  [{ found: false, reason: "denied" }, "KALADA_REFERENCE_DENIED"],
  [{ found: "yes" }, "KALADA_REFERENCE_ERROR"],
  [{ found: true, value: Number.NaN }, "KALADA_INVALID_RESULT"],
])("contains resolver outcome %#", (resolution, code) => {
  const compiled = compileKaladaV1Program(KaladaV1.program(KaladaV1.ref("host")));
  expect(compiled.ok && compiled.value.evaluate(() => resolution as never)).toMatchObject({
    ok: false,
    diagnostic: { code, path: ["expression"] },
  });
});

it("contains thrown, asynchronous, accessor, and proxy resolver outcomes", () => {
  const compiled = compileKaladaV1Program(KaladaV1.program(KaladaV1.ref("host")));
  if (!compiled.ok) return;
  expect(
    compiled.value.evaluate(() => {
      throw new Error("no");
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_REFERENCE_ERROR" } });
  expect(
    compiled.value.evaluate(() => Promise.resolve({ found: true, value: 1 }) as never),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_ASYNC_UNSUPPORTED" } });
  const getter = Object.defineProperty({}, "found", { enumerable: true, get: () => true });
  expect(compiled.value.evaluate(() => getter as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_REFERENCE_ERROR" },
  });
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("no");
      },
    },
  );
  expect(compiled.value.evaluate(() => proxy as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_REFERENCE_ERROR" },
  });
});

it("accepts only branded ADTs from resolvers and snapshots JSON", () => {
  const compiled = compileKaladaV1Program(KaladaV1.program(KaladaV1.ref("host")));
  if (!compiled.ok) return;
  const branded = compiled.value.evaluate(() => ({ found: true, value: Result.err("x") }));
  expect(branded.ok && equalKaladaValues(branded.value, Result.err("x"))).toBe(true);
  const spoof = { type: "Option", variant: "none" };
  expect(compiled.value.evaluate(() => ({ found: true, value: spoof }))).toMatchObject({
    ok: true,
    value: spoof,
  });
});

it("enforces exact resolver-branded ADT depth and node boundaries", () => {
  const expression = KaladaV1.program(KaladaV1.ref("host"));
  const depthPass = compileKaladaV1Program(expression, {
    limits: { maxValueDepth: 1, maxValueNodes: 2 },
  });
  const depthFail = compileKaladaV1Program(expression, {
    limits: { maxValueDepth: 1, maxValueNodes: 3 },
  });
  const nodeFail = compileKaladaV1Program(expression, {
    limits: { maxValueDepth: 2, maxValueNodes: 2 },
  });
  const oneDeep = Option.some(1);
  const twoDeep = Option.some(oneDeep);
  expect(
    depthPass.ok && depthPass.value.evaluate(() => ({ found: true, value: oneDeep })),
  ).toMatchObject({ ok: true });
  expect(
    depthFail.ok && depthFail.value.evaluate(() => ({ found: true, value: twoDeep })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression"] },
  });
  expect(
    nodeFail.ok && nodeFail.value.evaluate(() => ({ found: true, value: twoDeep })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression"] },
  });
});

it("extracts first-seen external dependencies with lexical exclusions", () => {
  const expression = KaladaV1.binding(
    "local",
    KaladaV1.ref("initializer"),
    KaladaV1.match("Option", KaladaV1.ref("source"), [
      KaladaV1.arm(
        "some",
        KaladaV1.binding("shadow", KaladaV1.ref("local"), KaladaV1.ref("payload")),
        "payload",
      ),
      KaladaV1.arm("none", KaladaV1.ref("initializer")),
    ]),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  expect(compiled.ok && compiled.value.dependencies).toEqual(["initializer", "source"]);
});

it("deduplicates custom references by property-order-independent canonical identity", () => {
  type Reference = { [key: string]: number };
  const first: Reference = { a: 1, b: 2 };
  const second: Reference = { b: 2, a: 1 };
  const expression = KaladaV1.binding("unused", KaladaV1.ref(first), KaladaV1.ref(second));
  const compiled = compileKaladaV1Program<Reference>(KaladaV1.program(expression), {
    reference: {
      validate: (input): input is Reference => typeof input === "object" && input !== null,
      canonicalize: (reference) => reference,
    },
  });
  expect(compiled.ok && compiled.value.dependencies).toEqual([{ a: 1, b: 2 }]);
});

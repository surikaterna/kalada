import { expect, it, vi } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  Duration,
  decodeKaladaValue,
  encodeKaladaValue,
  equalKaladaValues,
  Instant,
  isDuration,
  isInstant,
  KaladaV1,
  Option,
  Result,
} from "../index.js";

const missing = () => ({ found: false as const });

function compile(expression: ReturnType<typeof KaladaV1.instant>, maxEvaluationSteps = 100) {
  const result = compileKaladaV1Program(KaladaV1.program(expression), {
    limits: { maxEvaluationSteps },
  });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

it("constructs frozen, nominal, safe-integer temporal values", () => {
  for (const value of [Number.MIN_SAFE_INTEGER, -1, -0, 0, 1, Number.MAX_SAFE_INTEGER]) {
    const instant = Instant.fromMilliseconds(value);
    const duration = Duration.fromMilliseconds(value);
    expect(Object.isFrozen(instant)).toBe(true);
    expect(Object.isFrozen(duration)).toBe(true);
    expect(Object.is(instant.milliseconds, -0)).toBe(false);
    expect(Object.is(duration.milliseconds, -0)).toBe(false);
    expect(isInstant(instant)).toBe(true);
    expect(isDuration(duration)).toBe(true);
  }
  for (const invalid of [Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1, 0.5, NaN]) {
    expect(() => Instant.fromMilliseconds(invalid)).toThrow(RangeError);
    expect(() => Duration.fromMilliseconds(invalid)).toThrow(RangeError);
  }
  const instant = Instant.fromMilliseconds(1);
  expect(isInstant({ type: "Instant", milliseconds: 1 })).toBe(false);
  expect(isInstant({ ...instant })).toBe(false);
  expect(isInstant(JSON.parse(JSON.stringify(instant)))).toBe(false);
  expect(isInstant(new Proxy(instant, {}))).toBe(false);
});

it("canonicalizes exact temporal nodes and safe-integer boundaries", () => {
  for (const milliseconds of [Number.MIN_SAFE_INTEGER, -0, Number.MAX_SAFE_INTEGER]) {
    const result = canonicalizeKaladaV1Program(KaladaV1.program(KaladaV1.instant(milliseconds)));
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.value.expression.kind === "instant") {
      expect(Object.is(result.value.expression.milliseconds, -0)).toBe(false);
      expect(Object.isFrozen(result.value.expression)).toBe(true);
    }
  }
  for (const milliseconds of [Number.MIN_SAFE_INTEGER - 1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      canonicalizeKaladaV1Program(KaladaV1.program(KaladaV1.duration(milliseconds))),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "milliseconds"] },
    });
  }
  expect(
    canonicalizeKaladaV1Program({
      ...KaladaV1.program(KaladaV1.currentInstant()),
      expression: { kind: "current-instant", extra: true },
    }),
  ).toMatchObject({ ok: false });
  const hostile = Object.defineProperty({ kind: "instant" }, "milliseconds", {
    enumerable: true,
    get: () => 1,
  });
  expect(
    canonicalizeKaladaV1Program({ ...KaladaV1.program(KaladaV1.instant(0)), expression: hostile }),
  ).toMatchObject({ ok: false });
});

it("round-trips temporal envelopes alone and inside Option", () => {
  for (const value of [
    Instant.fromMilliseconds(Number.MIN_SAFE_INTEGER),
    Duration.fromMilliseconds(-7),
    Instant.fromMilliseconds(Number.MAX_SAFE_INTEGER),
  ]) {
    const encoded = encodeKaladaValue(value);
    expect(encoded).toEqual({
      format: "kalada-value",
      version: 1,
      type: value.type,
      variant: "milliseconds",
      value: value.milliseconds,
    });
    expect(equalKaladaValues(decodeKaladaValue(encoded), value)).toBe(true);
    expect(
      equalKaladaValues(
        decodeKaladaValue(encodeKaladaValue(Option.some(Result.ok(value)))),
        Option.some(Result.ok(value)),
      ),
    ).toBe(true);
  }
  const collision = { type: "Instant", milliseconds: 1 };
  expect(decodeKaladaValue(encodeKaladaValue(collision))).toEqual(collision);
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 0.5, Number.NaN]) {
    expect(() =>
      decodeKaladaValue({
        format: "kalada-value",
        version: 1,
        type: "Instant",
        variant: "milliseconds",
        value,
      }),
    ).toThrow(TypeError);
  }
});

it.each([
  ["add", KaladaV1.instant(10), KaladaV1.duration(3), "Instant", 13],
  ["add", KaladaV1.duration(10), KaladaV1.duration(-3), "Duration", 7],
  ["subtract", KaladaV1.instant(10), KaladaV1.instant(3), "Duration", 7],
  ["subtract", KaladaV1.instant(10), KaladaV1.duration(3), "Instant", 7],
  ["subtract", KaladaV1.duration(10), KaladaV1.duration(3), "Duration", 7],
] as const)("evaluates typed %s arithmetic", (operator, left, right, type, milliseconds) => {
  const output = compile(KaladaV1.temporalArithmetic(operator, left, right)).evaluate(missing);
  expect(output).toMatchObject({ ok: true, value: { type, milliseconds } });
});

it.each([
  ["equal", 2, 2, true],
  ["not-equal", 2, 3, true],
  ["less-than", 2, 3, true],
  ["less-than-or-equal", 2, 2, true],
  ["greater-than", 3, 2, true],
  ["greater-than-or-equal", 3, 3, true],
] as const)("evaluates %s comparisons", (operator, left, right, expected) => {
  const expression = KaladaV1.temporalComparison(
    operator,
    KaladaV1.duration(left),
    KaladaV1.duration(right),
  );
  expect(compile(expression).evaluate(missing)).toEqual({ ok: true, value: expected });
});

it("contains type mismatches and overflow at the right operand", () => {
  for (const expression of [
    KaladaV1.temporalArithmetic("add", KaladaV1.instant(1), KaladaV1.instant(1)),
    KaladaV1.temporalArithmetic("add", KaladaV1.duration(1), KaladaV1.instant(1)),
    KaladaV1.temporalArithmetic("subtract", KaladaV1.duration(1), KaladaV1.instant(1)),
    KaladaV1.temporalComparison("equal", KaladaV1.instant(1), KaladaV1.duration(1)),
  ]) {
    expect(compile(expression).evaluate(missing)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "KALADA_TEMPORAL_TYPE_MISMATCH",
        path: ["expression", "right"],
      },
    });
  }
  for (const expression of [
    KaladaV1.temporalArithmetic(
      "add",
      KaladaV1.instant(Number.MAX_SAFE_INTEGER),
      KaladaV1.duration(1),
    ),
    KaladaV1.temporalArithmetic(
      "subtract",
      KaladaV1.instant(Number.MIN_SAFE_INTEGER),
      KaladaV1.duration(1),
    ),
  ]) {
    expect(compile(expression).evaluate(missing)).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_TEMPORAL_OVERFLOW", path: ["expression", "right"] },
    });
  }
});

it("validates subtraction types before boundary arithmetic", () => {
  const expression = KaladaV1.temporalArithmetic(
    "subtract",
    KaladaV1.duration(Number.MAX_SAFE_INTEGER),
    KaladaV1.instant(Number.MIN_SAFE_INTEGER),
  );
  expect(compile(expression).evaluate(missing)).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_TEMPORAL_TYPE_MISMATCH",
      path: ["expression", "right"],
    },
  });
});

it("evaluates left first and charges exactly one step per AST node", () => {
  const resolve = vi.fn(() => ({ found: true as const, value: Duration.fromMilliseconds(1) }));
  const expression = KaladaV1.temporalArithmetic(
    "add",
    KaladaV1.literal(false),
    KaladaV1.ref("right"),
  );
  expect(compile(expression).evaluate(resolve)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_TEMPORAL_TYPE_MISMATCH", path: ["expression", "left"] },
  });
  expect(resolve).not.toHaveBeenCalled();
  const valid = KaladaV1.temporalArithmetic("add", KaladaV1.instant(1), KaladaV1.duration(1));
  expect(compile(valid, 3).evaluate(missing)).toMatchObject({ ok: true });
  expect(compile(valid, 2).evaluate(missing)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression", "right"] },
  });
});

it("uses only explicit current-instant inputs and preserves sample identity", () => {
  const compiled = compile(KaladaV1.currentInstant());
  const ambient = vi.spyOn(Date, "now");
  expect(compiled.evaluate(missing)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INSTANT_REQUIRED", path: ["expression"] },
  });
  const sample = Instant.fromMilliseconds(-123);
  const output = compiled.evaluate(missing, { instant: sample });
  expect(output.ok && output.value).toBe(sample);
  expect(ambient).not.toHaveBeenCalled();
  ambient.mockRestore();
  expect(
    compiled.evaluate(missing, {
      get instant() {
        throw new Error("hostile");
      },
    } as never),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["inputs", "instant"] },
  });
  expect(compiled.evaluate(missing, Object.create({ instant: sample }) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INSTANT_REQUIRED", path: ["expression"] },
  });
  expect(compiled.evaluate(missing, { instant: sample, extra: true } as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["inputs", "extra"] },
  });
});

it("samples clocks eagerly and exactly once for nested reads", () => {
  const expression = KaladaV1.temporalComparison(
    "equal",
    KaladaV1.currentInstant(),
    KaladaV1.currentInstant(),
  );
  const clock = vi.fn(() => Instant.fromMilliseconds(42));
  expect(compile(expression).evaluateWithClock(missing, clock)).toEqual({ ok: true, value: true });
  expect(clock).toHaveBeenCalledTimes(1);
  const eager = vi.fn(() => Instant.fromMilliseconds(1));
  expect(compile(KaladaV1.instant(0)).evaluateWithClock(missing, eager)).toMatchObject({
    ok: true,
  });
  expect(eager).toHaveBeenCalledTimes(1);
});

it("contains throwing, async, spoofed, and hostile clock results", () => {
  const compiled = compile(KaladaV1.currentInstant());
  expect(
    compiled.evaluateWithClock(missing, () => {
      throw new Error("clock");
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CLOCK_ERROR", path: ["clock"] },
  });
  expect(compiled.evaluateWithClock(missing, (() => Promise.resolve(1)) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_ASYNC_UNSUPPORTED", path: ["clock"] },
  });
  expect(
    compiled.evaluateWithClock(missing, (() => ({ type: "Instant", milliseconds: 1 })) as never),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_CLOCK", path: ["clock"] },
  });
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new Error("hostile");
      },
    },
  );
  expect(compiled.evaluateWithClock(missing, (() => hostile) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_CLOCK", path: ["clock"] },
  });
});

it("preserves temporal resolver values and exact branded-value budgets", () => {
  const expression = KaladaV1.program(KaladaV1.ref("time"));
  const pass = compileKaladaV1Program(expression, {
    limits: { maxValueDepth: 1, maxValueNodes: 2 },
  });
  const fail = compileKaladaV1Program(expression, {
    limits: { maxValueDepth: 1, maxValueNodes: 1 },
  });
  const value = Option.some(Instant.fromMilliseconds(1));
  expect(pass.ok && pass.value.evaluate(() => ({ found: true, value }))).toMatchObject({
    ok: true,
  });
  expect(fail.ok && fail.value.evaluate(() => ({ found: true, value }))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression"] },
  });
});

it("collects temporal child dependencies in left-first order", () => {
  const expression = KaladaV1.temporalArithmetic(
    "subtract",
    KaladaV1.ref("left"),
    KaladaV1.ref("right"),
  );
  expect(compile(expression).dependencies).toEqual(["left", "right"]);
});

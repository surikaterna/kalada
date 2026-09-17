import { expect, it, vi } from "vitest";
import { evaluateKaladaV1 } from "../evaluate.js";
import { compileKaladaV1Program, Instant, KaladaV1 } from "../index.js";
import { resolveLimits } from "../limits.js";
import type { KaladaV1Expression, KaladaV1Options } from "../types.js";

const number = KaladaV1.Type.primitive("number");
const optionNumber = KaladaV1.Type.option(number);
const missing = () => ({ found: false as const });
const literal = (value: null | boolean | number | string) => KaladaV1.literal(value);

function run(expression: KaladaV1Expression, options: KaladaV1Options<string> = {}) {
  const compiled = compileKaladaV1Program(KaladaV1.program(expression), options);
  if (!compiled.ok) throw new Error(compiled.diagnostic.code);
  return compiled.value.evaluate(missing);
}

function recursiveGroup(body: KaladaV1Expression, initial: KaladaV1Expression) {
  return KaladaV1.functionGroup(
    [KaladaV1.namedFunction("loop", [KaladaV1.parameter("n", optionNumber)], number, body)],
    KaladaV1.call(KaladaV1.ref("loop"), [initial]),
  );
}

function countdownBody(target: string): KaladaV1Expression {
  return KaladaV1.match("Option", KaladaV1.ref("n"), [
    KaladaV1.arm("some", KaladaV1.call(KaladaV1.ref(target), [KaladaV1.Option.none()]), "next"),
    KaladaV1.arm("none", literal(7)),
  ]);
}

function deepCallGroup(depth: number): KaladaV1Expression {
  const functions = Array.from({ length: depth }, (_, index) =>
    KaladaV1.namedFunction(
      `f${index}`,
      [],
      number,
      index + 1 === depth ? literal(7) : KaladaV1.call(KaladaV1.ref(`f${index + 1}`), []),
    ),
  );
  return KaladaV1.functionGroup(functions, KaladaV1.call(KaladaV1.ref("f0"), []));
}

it("captures definition scope and immediately calls a returned higher-order closure", () => {
  const lexical = KaladaV1.binding(
    "value",
    literal(1),
    KaladaV1.binding(
      "read",
      KaladaV1.function([], number, KaladaV1.ref("value")),
      KaladaV1.binding("value", literal(2), KaladaV1.call(KaladaV1.ref("read"), [])),
    ),
  );
  expect(run(lexical)).toEqual({ ok: true, value: 1 });

  const maker = KaladaV1.function(
    [KaladaV1.parameter("captured", number)],
    KaladaV1.Type.function([], number),
    KaladaV1.function([], number, KaladaV1.ref("captured")),
  );
  expect(run(KaladaV1.call(KaladaV1.call(maker, [literal(9)]), []))).toEqual({
    ok: true,
    value: 9,
  });
});

it("contains callable escapes at top level and ADT boundaries", () => {
  const fn = KaladaV1.function([], number, literal(1));
  expect(run(fn)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_ESCAPE", path: ["expression"] },
  });
  expect(run(KaladaV1.Option.some(fn))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_ESCAPE", path: ["expression", "value"] },
  });
  expect(run(KaladaV1.Result.err(fn))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_ESCAPE", path: ["expression", "value"] },
  });
  const forged = { callable: "user" } as never;
  const resolved = compileKaladaV1Program(KaladaV1.program(KaladaV1.ref("host")));
  expect(resolved.ok && resolved.value.evaluate(() => ({ found: true, value: forged }))).toEqual({
    ok: true,
    value: { callable: "user" },
  });
});

it("executes finite direct and mutual recursion", () => {
  expect(run(recursiveGroup(countdownBody("loop"), KaladaV1.Option.some(literal(12))))).toEqual({
    ok: true,
    value: 7,
  });
  const mutual = KaladaV1.functionGroup(
    [
      KaladaV1.namedFunction(
        "left",
        [KaladaV1.parameter("n", optionNumber)],
        number,
        countdownBody("right"),
      ),
      KaladaV1.namedFunction(
        "right",
        [KaladaV1.parameter("n", optionNumber)],
        number,
        countdownBody("left"),
      ),
    ],
    KaladaV1.call(KaladaV1.ref("left"), [KaladaV1.Option.some(literal(11))]),
  );
  expect(run(mutual)).toEqual({ ok: true, value: 7 });
});

it("uses the trampoline for deep and infinite recursion", () => {
  expect(
    run(deepCallGroup(180), {
      limits: {
        maxFunctionGroupSize: 200,
        maxCallDepth: 256,
        maxEvaluationSteps: 20_000,
      },
    }),
  ).toEqual({ ok: true, value: 7 });

  const infinite = recursiveGroup(
    KaladaV1.call(KaladaV1.ref("loop"), [KaladaV1.ref("n")]),
    KaladaV1.Option.none(),
  );
  const outcome = run(infinite, { limits: { maxCallDepth: 128, maxEvaluationSteps: 20_000 } });
  expect(outcome).toMatchObject({ ok: false, diagnostic: { code: "KALADA_CALL_DEPTH_LIMIT" } });
  expect(outcome.ok || outcome.diagnostic.message).not.toContain("RangeError");
});

it("checks callability and arity before evaluating arguments", () => {
  const seen: string[] = [];
  const dynamic = compileKaladaV1Program(
    KaladaV1.program(KaladaV1.call(KaladaV1.ref("callee"), [KaladaV1.ref("argument")])),
  );
  expect(
    dynamic.ok &&
      dynamic.value.evaluate((reference) => {
        seen.push(reference);
        return { found: true, value: 1 };
      }),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_NOT_CALLABLE" } });
  expect(seen).toEqual(["callee"]);

  const fn = KaladaV1.function([], number, literal(1));
  const raw = KaladaV1.call(fn, [KaladaV1.ref("argument")]);
  const resolver = vi.fn(() => ({ found: true as const, value: 1 }));
  expect(
    evaluateKaladaV1(raw, resolver, resolveLimits(), [
      { path: ["expression", "callee"], name: null, captures: [] },
    ]),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_ARITY", path: ["expression", "arguments"] },
  });
  expect(resolver).not.toHaveBeenCalled();
});

it("evaluates arguments left-to-right and validates dynamic arguments and returns", () => {
  const pair = KaladaV1.function(
    [KaladaV1.parameter("left", number), KaladaV1.parameter("right", number)],
    number,
    KaladaV1.ref("left"),
  );
  const order: string[] = [];
  const compiled = compileKaladaV1Program(
    KaladaV1.program(KaladaV1.call(pair, [KaladaV1.ref("first"), KaladaV1.ref("second")])),
  );
  const outcome =
    compiled.ok &&
    compiled.value.evaluate((reference) => {
      order.push(reference);
      return { found: true, value: reference === "first" ? 1 : 2 };
    });
  expect(outcome).toEqual({ ok: true, value: 1 });
  expect(order).toEqual(["first", "second"]);

  const mismatch = compileKaladaV1Program(
    KaladaV1.program(
      KaladaV1.call(
        KaladaV1.function([KaladaV1.parameter("x", number)], number, KaladaV1.ref("result")),
        [KaladaV1.ref("argument")],
      ),
    ),
  );
  expect(
    mismatch.ok && mismatch.value.evaluate(() => ({ found: true, value: false })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" },
  });
  expect(
    mismatch.ok &&
      mismatch.value.evaluate((reference) => ({
        found: true,
        value: reference === "argument" ? 1 : false,
      })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression"] },
  });
});

it("enforces closure and aggregate capture boundaries inclusively", () => {
  const one = KaladaV1.functionGroup(
    [KaladaV1.namedFunction("one", [], number, literal(1))],
    literal(0),
  );
  const two = KaladaV1.functionGroup(
    [
      KaladaV1.namedFunction("one", [], number, literal(1)),
      KaladaV1.namedFunction("two", [], number, literal(2)),
    ],
    literal(0),
  );
  expect(run(one, { limits: { maxClosures: 1 } })).toEqual({ ok: true, value: 0 });
  expect(run(two, { limits: { maxClosures: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CLOSURE_LIMIT" },
  });
  expect(run(two, { limits: { maxClosures: 2 } })).toEqual({ ok: true, value: 0 });
  expect(run(two, { limits: { maxClosures: 3 } })).toEqual({ ok: true, value: 0 });

  const captured = KaladaV1.binding(
    "x",
    literal(1),
    KaladaV1.functionGroup(
      [
        KaladaV1.namedFunction("one", [], number, KaladaV1.ref("x")),
        KaladaV1.namedFunction("two", [], number, KaladaV1.ref("x")),
      ],
      literal(0),
    ),
  );
  expect(run(captured, { limits: { maxCapturedBindings: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CAPTURE_LIMIT" },
  });
  expect(run(captured, { limits: { maxCapturedBindings: 2 } })).toEqual({ ok: true, value: 0 });
  expect(run(captured, { limits: { maxCapturedBindings: 3 } })).toEqual({ ok: true, value: 0 });
});

it("enforces continuation and step boundaries inclusively", () => {
  const identity = KaladaV1.function([KaladaV1.parameter("x", number)], number, KaladaV1.ref("x"));
  const call = KaladaV1.call(identity, [literal(1)]);
  expect(run(call, { limits: { maxContinuationFrames: 1, maxEvaluationSteps: 9 } })).toEqual({
    ok: true,
    value: 1,
  });
  expect(run(call, { limits: { maxEvaluationSteps: 8 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT" },
  });
  expect(run(call, { limits: { maxEvaluationSteps: 10 } })).toEqual({ ok: true, value: 1 });
  const nested = KaladaV1.call(identity, [KaladaV1.call(identity, [literal(1)])]);
  expect(run(nested, { limits: { maxContinuationFrames: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CONTINUATION_LIMIT" },
  });
  expect(run(nested, { limits: { maxContinuationFrames: 2 } })).toEqual({ ok: true, value: 1 });
  const triple = KaladaV1.call(identity, [nested]);
  expect(run(triple, { limits: { maxContinuationFrames: 2 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CONTINUATION_LIMIT" },
  });
  expect(run(triple, { limits: { maxContinuationFrames: 3 } })).toEqual({ ok: true, value: 1 });
});

it("enforces active call depth at minus-one, equal, and plus-one boundaries", () => {
  const finite = recursiveGroup(countdownBody("loop"), KaladaV1.Option.some(literal(1)));
  expect(run(finite, { limits: { maxCallDepth: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CALL_DEPTH_LIMIT" },
  });
  expect(run(finite, { limits: { maxCallDepth: 2 } })).toEqual({ ok: true, value: 7 });
  expect(run(finite, { limits: { maxCallDepth: 3 } })).toEqual({ ok: true, value: 7 });
});

it("retains deterministic call context and samples the clock once through calls", () => {
  const fn = KaladaV1.function([], number, KaladaV1.ref("missing"));
  const failed = run(KaladaV1.call(fn, []));
  expect(failed).toMatchObject({
    ok: false,
    diagnostic: { context: [{ kind: "function-call", name: null, path: ["expression"] }] },
  });
  if (!failed.ok) expect(Object.isFrozen(failed.diagnostic.context)).toBe(true);

  const clock = vi.fn(() => Instant.fromMilliseconds(42));
  const current = KaladaV1.call(
    KaladaV1.function([], KaladaV1.Type.primitive("Instant"), KaladaV1.currentInstant()),
    [],
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(current));
  expect(compiled.ok && compiled.value.evaluateWithClock(missing, clock)).toMatchObject({
    ok: true,
    value: { milliseconds: 42 },
  });
  expect(clock).toHaveBeenCalledTimes(1);
});

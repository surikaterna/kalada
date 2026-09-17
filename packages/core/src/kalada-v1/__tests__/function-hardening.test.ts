import { expect, it, vi } from "vitest";
import { compileKaladaV1Program, Instant, KaladaV1 } from "../index.js";
import type { KaladaV1Expression, KaladaV1Resolution } from "../types.js";

const number = KaladaV1.Type.primitive("number");
const json = KaladaV1.Type.primitive("json");
const missing = () => ({ found: false as const });

function compile(expression: KaladaV1Expression) {
  const outcome = compileKaladaV1Program(KaladaV1.program(expression));
  if (!outcome.ok) throw new Error(outcome.diagnostic.code);
  return outcome.value;
}

function evaluate(
  expression: KaladaV1Expression,
  resolve: (reference: string) => KaladaV1Resolution = missing,
) {
  return compile(expression).evaluate(resolve);
}

it("integrates lexical capture, higher-order passing, returning, and immediate invocation", () => {
  const readerType = KaladaV1.Type.function([], number);
  const invoke = KaladaV1.function(
    [KaladaV1.parameter("read", readerType)],
    number,
    KaladaV1.call(KaladaV1.ref("read"), []),
  );
  const expression = KaladaV1.binding(
    "captured",
    KaladaV1.literal(41),
    KaladaV1.call(
      KaladaV1.function(
        [],
        number,
        KaladaV1.call(invoke, [KaladaV1.function([], number, KaladaV1.ref("captured"))]),
      ),
      [],
    ),
  );
  const program = compile(expression);
  expect(program.evaluate(missing)).toEqual({ ok: true, value: 41 });
  expect(program.functions).toEqual([
    { path: ["expression", "body", "callee"], name: null, captures: ["captured"] },
    {
      path: ["expression", "body", "callee", "body", "callee"],
      name: null,
      captures: [],
    },
    {
      path: ["expression", "body", "callee", "body", "arguments", 0],
      name: null,
      captures: ["captured"],
    },
  ]);
  expect(Object.isFrozen(program.functions)).toBe(true);
  expect(program.functions.every(Object.isFrozen)).toBe(true);
});

it("blocks callable escape through every ADT constructor variant", () => {
  const callable = KaladaV1.function([], number, KaladaV1.literal(1));
  const cases = [
    KaladaV1.Option.some(callable),
    KaladaV1.Result.ok(callable),
    KaladaV1.Result.err(callable),
  ];
  for (const expression of cases) {
    expect(evaluate(expression)).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_FUNCTION_ESCAPE", path: ["expression", "value"] },
    });
  }
});

it("contains hostile resolver values inside calls and leaves the program reusable", () => {
  const expression = KaladaV1.call(
    KaladaV1.function([KaladaV1.parameter("value", json)], json, KaladaV1.ref("value")),
    [KaladaV1.ref("host")],
  );
  const program = compile(expression);
  const cycle: unknown[] = [];
  cycle.push(cycle);
  const sparse = Array(1);
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("hostile");
      },
    },
  );
  for (const value of [cycle, sparse, accessor, proxy]) {
    const outcome = program.evaluate(() => ({ found: true, value }) as never);
    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_INVALID_RESULT", path: ["expression", "arguments", 0] },
    });
    if (!outcome.ok) expect(Object.isFrozen(outcome.diagnostic)).toBe(true);
  }
  expect(program.evaluate(() => ({ found: true, value: { safe: true } }))).toEqual({
    ok: true,
    value: { safe: true },
  });
});

it("preserves validation precedence without evaluating rejected work", () => {
  const argumentResolver = vi.fn(() => ({ found: true as const, value: 1 }));
  const badCall = KaladaV1.call(KaladaV1.ref("callee"), [KaladaV1.ref("argument")]);
  expect(
    evaluate(badCall, (reference) =>
      reference === "callee" ? { found: true, value: 0 } : argumentResolver(),
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_NOT_CALLABLE", path: ["expression", "callee"] },
  });
  expect(argumentResolver).not.toHaveBeenCalled();

  const callback = KaladaV1.function(
    [KaladaV1.parameter("value", json), KaladaV1.parameter("index", number)],
    json,
    KaladaV1.ref("unreached"),
  );
  const map = KaladaV1.call(KaladaV1.coreFunction("map"), [KaladaV1.literal([]), callback]);
  expect(evaluate(map)).toEqual({ ok: true, value: [] });
});

it("samples the clock once and freezes truncated recursive failure context", () => {
  const current = KaladaV1.call(
    KaladaV1.function([], KaladaV1.Type.primitive("Instant"), KaladaV1.currentInstant()),
    [],
  );
  const clock = vi.fn(() => Instant.fromMilliseconds(9));
  expect(compile(current).evaluateWithClock(missing, clock)).toMatchObject({
    ok: true,
    value: { milliseconds: 9 },
  });
  expect(clock).toHaveBeenCalledTimes(1);

  const functions = Array.from({ length: 40 }, (_, index) =>
    KaladaV1.namedFunction(
      `f${index}`,
      [],
      number,
      index === 39 ? KaladaV1.ref("missing") : KaladaV1.call(KaladaV1.ref(`f${index + 1}`), []),
    ),
  );
  const failed = compileKaladaV1Program(
    KaladaV1.program(KaladaV1.functionGroup(functions, KaladaV1.call(KaladaV1.ref("f0"), []))),
    { limits: { maxFunctionGroupSize: 40 } },
  );
  if (!failed.ok) throw new Error(failed.diagnostic.code);
  const outcome = failed.value.evaluate(missing);
  if (outcome.ok) throw new Error("expected failure");
  expect(outcome.diagnostic.context).toHaveLength(32);
  expect(Object.isFrozen(outcome.diagnostic.context)).toBe(true);
  expect(outcome.diagnostic.context?.every((frame) => Object.isFrozen(frame.path))).toBe(true);
});

import { expect, it } from "vitest";
import { compileKaladaV1Program, KaladaV1 } from "../index.js";
import type { KaladaV1Expression, KaladaV1Resolver } from "../types.js";

const number = KaladaV1.Type.primitive("number");
const missing = () => ({ found: false as const });

function compile(expression: KaladaV1Expression) {
  const result = compileKaladaV1Program(KaladaV1.program(expression), {
    limits: { maxFunctionGroupSize: 64 },
  });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

function failingCallChain(depth: number): KaladaV1Expression {
  const functions = Array.from({ length: depth }, (_, index) =>
    KaladaV1.namedFunction(
      `f${index}`,
      [],
      number,
      index + 1 === depth
        ? KaladaV1.ref("missing")
        : KaladaV1.call(KaladaV1.ref(`f${index + 1}`), []),
    ),
  );
  return KaladaV1.functionGroup(functions, KaladaV1.call(KaladaV1.ref("f0"), []));
}

it("adds an own frozen empty context to function-runtime failures outside calls", () => {
  const program = compile(KaladaV1.call(KaladaV1.ref("callee"), []));
  const outcome = program.evaluate(() => ({ found: true, value: 1 }));
  expect(outcome).toEqual({
    ok: false,
    diagnostic: {
      code: "KALADA_NOT_CALLABLE",
      path: ["expression", "callee"],
      message: "Kalada call target is not callable.",
      context: [],
    },
  });
  if (outcome.ok) return;
  expect(Object.hasOwn(outcome.diagnostic, "context")).toBe(true);
  expect(Object.isFrozen(outcome.diagnostic.context)).toBe(true);
});

it("preserves legacy top-level diagnostic shape without context", () => {
  const temporal = KaladaV1.temporalArithmetic("add", KaladaV1.instant(1), KaladaV1.instant(2));
  const outcome = compile(temporal).evaluate(missing);
  expect(outcome).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_TEMPORAL_TYPE_MISMATCH" },
  });
  if (!outcome.ok) expect(Object.hasOwn(outcome.diagnostic, "context")).toBe(false);
});

it("derives nested context innermost-first from live return frames", () => {
  const outcome = compile(failingCallChain(3)).evaluate(missing);
  expect(outcome).toMatchObject({
    ok: false,
    diagnostic: {
      context: [
        { kind: "function-call", name: "f2", path: ["expression", "functions", 1, "body"] },
        { kind: "function-call", name: "f1", path: ["expression", "functions", 0, "body"] },
        { kind: "function-call", name: "f0", path: ["expression", "body"] },
      ],
    },
  });
});

it("keeps only 32 innermost frozen frames and frozen paths", () => {
  const outcome = compile(failingCallChain(40)).evaluate(missing);
  if (outcome.ok) throw new Error("expected failure");
  const context = outcome.diagnostic.context;
  expect(context).toHaveLength(32);
  expect(context?.map((frame) => frame.name)).toEqual(
    Array.from({ length: 32 }, (_, index) => `f${39 - index}`),
  );
  expect(Object.isFrozen(context)).toBe(true);
  for (const frame of context ?? []) {
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.path)).toBe(true);
  }
});

it("pops the returning function before type validation and fully unwinds failure", () => {
  const expression = KaladaV1.functionGroup(
    [
      KaladaV1.namedFunction("inner", [], number, KaladaV1.ref("dynamic")),
      KaladaV1.namedFunction("outer", [], number, KaladaV1.call(KaladaV1.ref("inner"), [])),
    ],
    KaladaV1.call(KaladaV1.ref("outer"), []),
  );
  const program = compile(expression);
  const resolver =
    (value: boolean | number): KaladaV1Resolver<string> =>
    () => ({
      found: true,
      value,
    });
  const failed = program.evaluate(resolver(false));
  expect(failed).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_FUNCTION_TYPE_MISMATCH",
      context: [{ kind: "function-call", name: "outer", path: ["expression", "body"] }],
    },
  });
  expect(program.evaluate(resolver(7))).toEqual({ ok: true, value: 7 });
});

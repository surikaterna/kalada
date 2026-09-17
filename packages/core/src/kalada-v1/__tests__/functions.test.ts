import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  KALADA_V1_FUNCTION_PROGRAM_SCHEMA,
  KALADA_V1_PROGRAM_SCHEMA,
  KaladaV1,
} from "../index.js";

const number = KaladaV1.Type.primitive("number");
const boolean = KaladaV1.Type.primitive("boolean");
const json = KaladaV1.Type.primitive("json");
const literal = (value: null | boolean | number | string) => KaladaV1.literal(value);

it("canonicalizes and deeply freezes explicit signatures in declaration order", () => {
  const expression = KaladaV1.function(
    [KaladaV1.parameter("left", number), KaladaV1.parameter("right", number)],
    number,
    KaladaV1.ref("left"),
  );
  const result = canonicalizeKaladaV1Program(KaladaV1.program(expression));
  expect(result).toMatchObject({ ok: true });
  if (!result.ok || result.value.expression.kind !== "function") return;
  expect(result.value.expression.parameters.map((item) => item.name)).toEqual(["left", "right"]);
  expect(Object.isFrozen(result.value.expression)).toBe(true);
  expect(Object.isFrozen(result.value.expression.parameters)).toBe(true);
  expect(Object.isFrozen(result.value.expression.parameters[0]?.type)).toBe(true);
});

it("supports any expression as a callee and validates arity and invariant argument types", () => {
  const identity = KaladaV1.function(
    [KaladaV1.parameter("value", number)],
    number,
    KaladaV1.ref("value"),
  );
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.call(identity, [literal(1)]))),
  ).toMatchObject({ ok: true });
  expect(compileKaladaV1Program(KaladaV1.program(KaladaV1.call(identity, [])))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_ARITY", path: ["expression", "arguments"] },
  });
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.call(identity, [literal(true)]))),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "arguments", 0] },
  });
  expect(compileKaladaV1Program(KaladaV1.program(KaladaV1.call(literal(1), [])))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_NOT_CALLABLE", path: ["expression", "callee"] },
  });
});

it("keeps unknown external boundaries compilable while checking known returns", () => {
  const unknown = KaladaV1.function([], number, KaladaV1.ref("external"));
  const mismatch = KaladaV1.function([], number, literal(false));
  expect(compileKaladaV1Program(KaladaV1.program(unknown))).toMatchObject({ ok: true });
  expect(compileKaladaV1Program(KaladaV1.program(mismatch))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "body"] },
  });
});

it("models recursive groups and excludes recursive names and parameters from dependencies", () => {
  const group = KaladaV1.functionGroup(
    [
      KaladaV1.namedFunction(
        "even",
        [KaladaV1.parameter("n", number)],
        boolean,
        KaladaV1.call(KaladaV1.ref("odd"), [KaladaV1.ref("n")]),
      ),
      KaladaV1.namedFunction(
        "odd",
        [KaladaV1.parameter("n", number)],
        boolean,
        KaladaV1.ref("external"),
      ),
    ],
    KaladaV1.ref("even"),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(group));
  expect(compiled.ok && compiled.value.dependencies).toEqual(["external"]);
  expect(compiled.ok && compiled.value.functions.map((item) => item.name)).toEqual(["even", "odd"]);
});

it("orders captures by lexical first occurrence and honors binding and parameter shadowing", () => {
  const closure = KaladaV1.binding(
    "first",
    literal(1),
    KaladaV1.binding(
      "second",
      literal(2),
      KaladaV1.function(
        [KaladaV1.parameter("shadow", number)],
        number,
        KaladaV1.binding("first", KaladaV1.ref("second"), KaladaV1.ref("first")),
      ),
    ),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(closure));
  expect(compiled.ok && compiled.value.functions).toEqual([
    { path: ["expression", "body", "body"], name: null, captures: ["second"] },
  ]);
});

it("enforces duplicate, parameter, group, capture, and aggregate closure boundaries", () => {
  const duplicate = KaladaV1.function(
    [KaladaV1.parameter("x", number), KaladaV1.parameter("x", number)],
    number,
    literal(1),
  );
  expect(canonicalizeKaladaV1Program(KaladaV1.program(duplicate))).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_DUPLICATE_BINDING",
      path: ["expression", "parameters", 1, "name"],
    },
  });
  const twoParameters = KaladaV1.function(
    [KaladaV1.parameter("x", number), KaladaV1.parameter("y", number)],
    number,
    literal(1),
  );
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(twoParameters), {
      limits: { maxFunctionParameters: 1 },
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression", "parameters"] },
  });
  const captures = KaladaV1.binding(
    "a",
    literal(1),
    KaladaV1.binding(
      "b",
      literal(2),
      KaladaV1.function(
        [],
        number,
        KaladaV1.temporalArithmetic("add", KaladaV1.ref("a"), KaladaV1.ref("b")),
      ),
    ),
  );
  expect(
    compileKaladaV1Program(KaladaV1.program(captures), { limits: { maxCapturesPerClosure: 1 } }),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_CAPTURE_LIMIT" } });
});

it("contains cycles, sparse arrays, accessors, proxies, and extra keys", () => {
  const cyclic: Record<string, unknown> = { kind: "option-type" };
  cyclic.value = cyclic;
  const base = { kind: "function", parameters: [], returns: number, body: literal(1) };
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program({ ...base, returns: cyclic } as never)),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_INVALID_FUNCTION_TYPE" } });
  const sparse = Array(1);
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program({ ...base, parameters: sparse } as never)),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "parameters"] },
  });
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program({ ...base, forged: true } as never)),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "forged"] },
  });
  const getter = Object.defineProperty({}, "kind", { get: () => "function" });
  expect(canonicalizeKaladaV1Program(KaladaV1.program(getter as never))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT" },
  });
  const proxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("hostile");
      },
    },
  );
  expect(canonicalizeKaladaV1Program(KaladaV1.program(proxy as never))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT" },
  });
});

it("exposes only the four closed core callables and stages runtime as function escape", () => {
  for (const name of ["map", "filter", "some", "every"] as const) {
    const compiled = compileKaladaV1Program(KaladaV1.program(KaladaV1.coreFunction(name)));
    expect(compiled.ok && compiled.value.evaluate(() => ({ found: false }))).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_FUNCTION_ESCAPE", path: ["expression"] },
    });
  }
  expect(
    canonicalizeKaladaV1Program(
      KaladaV1.program({ kind: "core-function", name: "reduce" } as never),
    ),
  ).toMatchObject({ ok: false, diagnostic: { path: ["expression", "name"] } });
});

it("publishes a schema that accepts canonical function programs and rejects extras", () => {
  const validate = new Ajv2020({ strict: false }).compile(KALADA_V1_FUNCTION_PROGRAM_SCHEMA);
  const program = KaladaV1.program(
    KaladaV1.function([KaladaV1.parameter("value", json)], json, KaladaV1.ref("value")),
  );
  expect(validate(program)).toBe(true);
  expect(validate({ ...program, imports: [] })).toBe(false);
});

it("preserves Option and Result shapes during expected return checking", () => {
  const string = KaladaV1.Type.primitive("string");
  const optionNumber = KaladaV1.Type.option(number);
  const resultType = KaladaV1.Type.result(number, string);
  const compileReturn = (returns: typeof number, body: ReturnType<typeof literal>) =>
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], returns, body)));
  expect(compileReturn(number, KaladaV1.Option.none() as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" },
  });
  expect(compileReturn(optionNumber, KaladaV1.Option.none() as never)).toMatchObject({ ok: true });
  expect(compileReturn(optionNumber, KaladaV1.Option.some(literal(1)) as never)).toMatchObject({
    ok: true,
  });
  expect(compileReturn(optionNumber, KaladaV1.Option.some(literal(false)) as never)).toMatchObject({
    ok: false,
  });
  expect(compileReturn(resultType, KaladaV1.Result.ok(literal(1)) as never)).toMatchObject({
    ok: true,
  });
  expect(compileReturn(resultType, KaladaV1.Result.err(literal("bad")) as never)).toMatchObject({
    ok: true,
  });
  expect(compileReturn(resultType, KaladaV1.Result.ok(literal(false)) as never)).toMatchObject({
    ok: false,
  });
  expect(compileReturn(resultType, KaladaV1.Result.err(literal(2)) as never)).toMatchObject({
    ok: false,
  });
});

it("preserves temporal result types and rejects heterogeneous match joins", () => {
  const instant = KaladaV1.Type.primitive("Instant");
  const duration = KaladaV1.Type.primitive("Duration");
  const arithmetic = KaladaV1.temporalArithmetic("add", KaladaV1.instant(1), KaladaV1.duration(2));
  const durationArithmetic = KaladaV1.temporalArithmetic(
    "subtract",
    KaladaV1.instant(3),
    KaladaV1.instant(1),
  );
  const temporalComparison = KaladaV1.temporalComparison(
    "equal",
    KaladaV1.duration(1),
    KaladaV1.duration(1),
  );
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], boolean, arithmetic))),
  ).toMatchObject({ ok: false });
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], instant, arithmetic))),
  ).toMatchObject({ ok: true });
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], duration, durationArithmetic))),
  ).toMatchObject({ ok: true });
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], boolean, temporalComparison))),
  ).toMatchObject({ ok: true });
  const mixed = KaladaV1.match("Option", KaladaV1.Option.none(), [
    KaladaV1.arm("some", literal(1), "value"),
    KaladaV1.arm("none", literal(false)),
  ]);
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], number, mixed))),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" } });
});

it("does not charge runtime materialization limits during static analysis", () => {
  const group = KaladaV1.binding(
    "captured",
    literal(1),
    KaladaV1.functionGroup(
      [
        KaladaV1.namedFunction("first", [], number, KaladaV1.ref("captured")),
        KaladaV1.namedFunction("second", [], number, KaladaV1.ref("captured")),
      ],
      literal(0),
    ),
  );
  expect(
    compileKaladaV1Program(KaladaV1.program(group), {
      limits: { maxClosures: 1, maxCapturedBindings: 1 },
    }),
  ).toMatchObject({ ok: true });
});

it("propagates typed Option and Result payloads through match branches", () => {
  const string = KaladaV1.Type.primitive("string");
  const optionBody = KaladaV1.match("Option", KaladaV1.ref("input"), [
    KaladaV1.arm("some", KaladaV1.ref("value"), "value"),
    KaladaV1.arm("none", literal(0)),
  ]);
  const optionFunction = KaladaV1.function(
    [KaladaV1.parameter("input", KaladaV1.Type.option(number))],
    number,
    optionBody,
  );
  expect(compileKaladaV1Program(KaladaV1.program(optionFunction))).toMatchObject({ ok: true });
  const resultBody = KaladaV1.match("Result", KaladaV1.ref("input"), [
    KaladaV1.arm("ok", literal("ok"), "value"),
    KaladaV1.arm("err", KaladaV1.ref("error"), "error"),
  ]);
  const resultFunction = KaladaV1.function(
    [KaladaV1.parameter("input", KaladaV1.Type.result(number, string))],
    string,
    resultBody,
  );
  expect(compileKaladaV1Program(KaladaV1.program(resultFunction))).toMatchObject({ ok: true });
});

it("registers legacy and additive program schemas without identity collision", () => {
  const ajv = new Ajv2020({ strict: false });
  expect(() => {
    ajv.addSchema(KALADA_V1_PROGRAM_SCHEMA);
    ajv.addSchema(KALADA_V1_FUNCTION_PROGRAM_SCHEMA);
  }).not.toThrow();
  expect(KALADA_V1_FUNCTION_PROGRAM_SCHEMA.$id).not.toBe(KALADA_V1_PROGRAM_SCHEMA.$id);
});

it("checks known match branches when the other Option branch is dynamic", () => {
  const compileMatch = (some: ReturnType<typeof KaladaV1.ref>, none: ReturnType<typeof literal>) =>
    compileKaladaV1Program(
      KaladaV1.program(
        KaladaV1.function(
          [],
          number,
          KaladaV1.match("Option", KaladaV1.ref("input"), [
            KaladaV1.arm("some", some, "value"),
            KaladaV1.arm("none", none),
          ]),
        ),
      ),
    );
  expect(compileMatch(KaladaV1.ref("external"), literal(false))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "body"] },
  });
  expect(compileMatch(KaladaV1.ref("external"), literal(1))).toMatchObject({ ok: true });
});

it("checks known-first branches when the other Option branch is dynamic", () => {
  const body = KaladaV1.match("Option", KaladaV1.ref("input"), [
    KaladaV1.arm("some", literal(false), "value"),
    KaladaV1.arm("none", KaladaV1.ref("external")),
  ]);
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], number, body))),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "body"] },
  });
});

it("applies dynamic-branch checking symmetrically to Result matches", () => {
  const body = KaladaV1.match("Result", KaladaV1.ref("input"), [
    KaladaV1.arm("ok", KaladaV1.ref("external"), "value"),
    KaladaV1.arm("err", literal(false), "error"),
  ]);
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], number, body))),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "body"] },
  });
});

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  KALADA_V1_FUNCTION_PROGRAM_SCHEMA,
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

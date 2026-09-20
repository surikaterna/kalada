import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, vi } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  equalKaladaValues,
  Instant,
  type JsonValue,
  KALADA_V1_FUNCTION_PROGRAM_SCHEMA,
  KALADA_V1_PROGRAM_SCHEMA,
  KaladaV1,
  type KaladaV1Expression,
  Option,
  Result,
} from "../index.js";

const missing = () => ({ found: false as const });

function run(
  expression: KaladaV1Expression,
  value: Parameters<typeof Option.some>[0],
  limits?: { readonly maxEvaluationSteps?: number; readonly maxContinuationFrames?: number },
) {
  const compiled = compileKaladaV1Program(KaladaV1.program(expression), { limits });
  if (!compiled.ok) return compiled;
  return compiled.value.evaluate(() => ({ found: true, value }));
}

it("canonicalizes exact frozen field nodes and applies field string limits", () => {
  const expression = KaladaV1.optionalFieldAccess(
    KaladaV1.fieldAccess(KaladaV1.literal({ nested: {} }), "nested"),
    "__proto__",
  );
  const result = canonicalizeKaladaV1Program(KaladaV1.program(expression));
  expect(result).toMatchObject({
    ok: true,
    value: {
      expression: {
        kind: "optional-field-access",
        field: "__proto__",
        target: { kind: "field-access", field: "nested" },
      },
    },
  });
  expect(result.ok && Object.isFrozen(result.value.expression)).toBe(true);
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(KaladaV1.fieldAccess(KaladaV1.literal({}), ""))),
  ).toMatchObject({ ok: true });
  expect(
    canonicalizeKaladaV1Program(
      KaladaV1.program(KaladaV1.fieldAccess(KaladaV1.literal({}), "xx")),
      { limits: { maxStringLength: 1 } },
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression", "field"] },
  });
});

it("rejects malformed and hostile field nodes without reading accessors", () => {
  const extra = { ...KaladaV1.fieldAccess(KaladaV1.literal({}), "x"), index: 0 };
  expect(canonicalizeKaladaV1Program(KaladaV1.program(extra))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "index"] },
  });
  const getter = vi.fn(() => "x");
  const hostile = Object.defineProperty(
    { kind: "field-access", target: KaladaV1.literal({}) },
    "field",
    { enumerable: true, get: getter },
  );
  expect(canonicalizeKaladaV1Program(KaladaV1.program(hostile as never))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "field"] },
  });
  expect(getter).not.toHaveBeenCalled();
});

it("counts field nodes and their target depth exactly", () => {
  const expression = KaladaV1.fieldAccess(
    KaladaV1.optionalFieldAccess(KaladaV1.literal({}), "inner"),
    "outer",
  );
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(expression), {
      limits: { maxAstDepth: 2, maxAstNodes: 3 },
    }),
  ).toMatchObject({ ok: true });
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(expression), {
      limits: { maxAstDepth: 1, maxAstNodes: 3 },
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression", "target", "target"] },
  });
});

it("performs strict own-data-field lookup and preserves present values", () => {
  const expression = KaladaV1.fieldAccess(KaladaV1.ref("target"), "present");
  expect(run(expression, { present: false })).toEqual({ ok: true, value: false });
  expect(run(KaladaV1.fieldAccess(KaladaV1.literal({}), "toString"), null)).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_FIELD_MISSING",
      path: ["expression", "field"],
      message: "Kalada field does not exist.",
    },
  });
});

it("never invokes a target getter", () => {
  const getter = vi.fn(() => 1);
  const target = Object.defineProperty({}, "value", { enumerable: true, get: getter });
  expect(run(KaladaV1.fieldAccess(KaladaV1.ref("target"), "value"), target as never)).toMatchObject(
    {
      ok: false,
      diagnostic: { code: "KALADA_INVALID_RESULT", path: ["expression", "target"] },
    },
  );
  expect(getter).not.toHaveBeenCalled();
});

it("returns strict missing and type diagnostics at stable suffixes", () => {
  expect(run(KaladaV1.fieldAccess(KaladaV1.ref("target"), "absent"), {})).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FIELD_MISSING", path: ["expression", "field"] },
  });
  for (const value of [
    null,
    [],
    "text",
    1,
    false,
    Option.none(),
    Result.ok(1),
    Instant.fromMilliseconds(0),
  ]) {
    expect(run(KaladaV1.fieldAccess(KaladaV1.ref("target"), "x"), value)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "KALADA_FIELD_TYPE_MISMATCH",
        path: ["expression", "target"],
        message: "Kalada field access requires a JSON object.",
      },
    });
  }
});

it("preserves optional missing, falsey, empty, and null outcomes", () => {
  const values: JsonValue[] = [false, 0, "", [], {}, null];
  for (const value of values) {
    const outcome = run(KaladaV1.optionalFieldAccess(KaladaV1.ref("target"), "value"), {
      value,
    });
    expect(outcome.ok && equalKaladaValues(outcome.value, Option.some(value))).toBe(true);
  }
  expect(run(KaladaV1.optionalFieldAccess(KaladaV1.ref("target"), "missing"), {})).toEqual({
    ok: true,
    value: Option.none(),
  });
});

it("unwraps one Option layer and rejects invalid or nested payloads", () => {
  const access = KaladaV1.optionalFieldAccess(KaladaV1.ref("target"), "value");
  expect(run(access, Option.none())).toEqual({ ok: true, value: Option.none() });
  expect(run(access, Option.some({ value: 7 }))).toMatchObject({
    ok: true,
    value: { type: "Option", variant: "some", value: 7 },
  });
  expect(run(access, Option.some(null))).toMatchObject({
    ok: true,
    value: { type: "Option", variant: "some", value: null },
  });
  for (const value of [Option.some(1), Option.some([]), Option.some(Option.some({ value: 1 }))]) {
    expect(run(access, value)).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_FIELD_TYPE_MISMATCH", path: ["expression", "target"] },
    });
  }
});

it("chains left-to-right while retaining terminal null and one-layer rules", () => {
  const nested = KaladaV1.optionalFieldAccess(
    KaladaV1.optionalFieldAccess(KaladaV1.literal({ child: { answer: 42 } }), "child"),
    "answer",
  );
  const terminalNull = KaladaV1.optionalFieldAccess(
    KaladaV1.optionalFieldAccess(KaladaV1.literal({ child: null }), "child"),
    "ignored",
  );
  const nestedOption = KaladaV1.optionalFieldAccess(
    KaladaV1.Option.some(KaladaV1.Option.some(KaladaV1.literal({ answer: 42 }))),
    "answer",
  );
  expect(run(nested, null)).toMatchObject({ ok: true, value: { variant: "some", value: 42 } });
  expect(run(terminalNull, null)).toMatchObject({
    ok: true,
    value: { variant: "some", value: null },
  });
  expect(compileKaladaV1Program(KaladaV1.program(nestedOption))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FIELD_TYPE_MISMATCH", path: ["expression", "target"] },
  });
});

it("evaluates the target once and treats the field as data, not a dependency", () => {
  const expression = KaladaV1.fieldAccess(KaladaV1.ref("target"), "not-a-reference");
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const resolve = vi.fn(() => ({ found: true as const, value: { "not-a-reference": 1 } }));
  expect(compiled.ok && compiled.value.dependencies).toEqual(["target"]);
  expect(compiled.ok && compiled.value.evaluate(resolve)).toEqual({ ok: true, value: 1 });
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("visits field targets during closure capture analysis", () => {
  const json = KaladaV1.Type.primitive("json");
  const expression = KaladaV1.binding(
    "captured",
    KaladaV1.literal({ value: 9 }),
    KaladaV1.call(
      KaladaV1.function([], json, KaladaV1.fieldAccess(KaladaV1.ref("captured"), "value")),
      [],
    ),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  expect(compiled.ok && compiled.value.functions[0]?.captures).toEqual(["captured"]);
  expect(compiled.ok && compiled.value.evaluate(missing)).toEqual({ ok: true, value: 9 });
});

it("uses one continuation and one step per field and target expression", () => {
  const expression = KaladaV1.fieldAccess(KaladaV1.ref("target"), "value");
  expect(
    run(expression, { value: 1 }, { maxContinuationFrames: 1, maxEvaluationSteps: 2 }),
  ).toEqual({ ok: true, value: 1 });
  const chained = KaladaV1.fieldAccess(expression, "nested");
  expect(run(chained, { value: { nested: 1 } }, { maxContinuationFrames: 1 })).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_CONTINUATION_LIMIT",
      path: ["expression", "target", "target"],
    },
  });
  expect(run(expression, { value: 1 }, { maxEvaluationSteps: 1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression", "target"] },
  });
});

it("publishes both expanded schemas while captured 0.5 strict schemas reject new nodes", () => {
  const strict = new Ajv2020({ strict: true }).compile(KALADA_V1_PROGRAM_SCHEMA);
  const functions = new Ajv2020({ strict: true }).compile(KALADA_V1_FUNCTION_PROGRAM_SCHEMA);
  const programs = [
    KaladaV1.program(KaladaV1.fieldAccess(KaladaV1.literal({ value: 1 }), "value")),
    KaladaV1.program(KaladaV1.optionalFieldAccess(KaladaV1.literal({ value: 1 }), "value")),
  ];
  for (const program of programs) {
    expect(strict(program)).toBe(true);
    expect(functions(program)).toBe(true);
  }
  for (const schema of [KALADA_V1_PROGRAM_SCHEMA, KALADA_V1_FUNCTION_PROGRAM_SCHEMA]) {
    const oldValidate = new Ajv2020({ strict: true }).compile(capturedOldStrictSchema(schema));
    expect(oldValidate(KaladaV1.program(KaladaV1.literal(1)))).toBe(true);
    for (const program of programs) expect(oldValidate(program)).toBe(false);
  }
});

it("retains representative existing canonical and runtime outcomes", () => {
  const existing = KaladaV1.program(
    KaladaV1.temporalArithmetic("add", KaladaV1.instant(10), KaladaV1.duration(5)),
  );
  expect(canonicalizeKaladaV1Program(existing)).toMatchObject({ ok: true, value: existing });
  const compiled = compileKaladaV1Program(existing);
  expect(compiled.ok && compiled.value.evaluate(missing)).toMatchObject({
    ok: true,
    value: { type: "Instant", milliseconds: 15 },
  });
});

function capturedOldStrictSchema(source: Readonly<Record<string, unknown>>): object {
  const schema = structuredClone(source) as {
    $id: string;
    $defs: {
      expression: {
        oneOf: Array<{ properties?: { kind?: { const?: string } } }>;
      };
    };
  };
  schema.$id = `${schema.$id}-captured-0.5`;
  schema.$defs.expression.oneOf = schema.$defs.expression.oneOf.filter((node) => {
    const kind = node.properties?.kind?.const;
    return kind !== "field-access" && kind !== "optional-field-access";
  });
  return schema;
}

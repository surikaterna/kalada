import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, vi } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  KALADA_V1_FUNCTION_PROGRAM_SCHEMA,
  KALADA_V1_PROGRAM_SCHEMA,
  type KaladaType,
  KaladaV1,
  type KaladaV1Expression,
  type KaladaValue,
  Option,
  Result,
} from "../index.js";

const literal = (value: Parameters<typeof KaladaV1.literal>[0]) => KaladaV1.literal(value);

function evaluate(
  expression: KaladaV1Expression,
  values: Readonly<Record<string, KaladaValue>> = {},
  limits: { maxEvaluationSteps?: number; maxContinuationFrames?: number } = {},
) {
  const compiled = compileKaladaV1Program(KaladaV1.program(expression), { limits });
  if (!compiled.ok) return compiled;
  return compiled.value.evaluate((reference) =>
    reference in values
      ? { found: true, value: values[reference] as KaladaValue }
      : { found: false },
  );
}

it("canonicalizes exact control nodes, round trips JSON, and rejects hostile shapes", () => {
  const expressions = [
    KaladaV1.conditional(literal(true), literal(1), literal(2)),
    KaladaV1.optionCoalesce(KaladaV1.Option.some(literal(1)), literal(2)),
  ];
  for (const expression of expressions) {
    const input = JSON.parse(JSON.stringify(KaladaV1.program(expression))) as unknown;
    const result = canonicalizeKaladaV1Program(input);
    expect(result).toMatchObject({ ok: true, value: { expression } });
    expect(result.ok && Object.isFrozen(result.value.expression)).toBe(true);
    expect(
      canonicalizeKaladaV1Program(KaladaV1.program({ ...expression, extra: true } as never)),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "extra"] },
    });
  }
  const hostile = { kind: "option-coalesce", option: KaladaV1.Option.none() } as Record<
    string,
    unknown
  >;
  Object.defineProperty(hostile, "fallback", { enumerable: true, get: () => literal(1) });
  expect(canonicalizeKaladaV1Program(KaladaV1.program(hostile as never))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "fallback"] },
  });

  const conditional = expressions[0] as KaladaV1Expression;
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(conditional), {
      limits: { maxAstNodes: 4 },
    }),
  ).toMatchObject({ ok: true });
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(conditional), {
      limits: { maxAstNodes: 3 },
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression", "else"] },
  });
  const coalesce = expressions[1] as KaladaV1Expression;
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(coalesce), { limits: { maxAstNodes: 4 } }),
  ).toMatchObject({ ok: true });
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(coalesce), { limits: { maxAstNodes: 3 } }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression", "fallback"] },
  });
});

it("evaluates a strict boolean condition and exactly one branch in the parent environment", () => {
  const expression = KaladaV1.binding(
    "local",
    literal("selected"),
    KaladaV1.conditional(KaladaV1.ref("condition"), KaladaV1.ref("local"), KaladaV1.ref("skipped")),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const resolve = vi.fn((reference: string) =>
    reference === "condition" ? { found: true as const, value: true } : { found: false as const },
  );
  expect(compiled.ok && compiled.value.evaluate(resolve)).toEqual({ ok: true, value: "selected" });
  expect(resolve).toHaveBeenCalledTimes(1);
  const falseBranch = compileKaladaV1Program(
    KaladaV1.program(
      KaladaV1.conditional(
        KaladaV1.ref("condition"),
        KaladaV1.ref("skipped"),
        KaladaV1.ref("selected"),
      ),
    ),
  );
  const order: string[] = [];
  expect(
    falseBranch.ok &&
      falseBranch.value.evaluate((reference) => {
        order.push(reference);
        return { found: true, value: reference === "selected" ? "else" : false };
      }),
  ).toEqual({ ok: true, value: "else" });
  expect(order).toEqual(["condition", "selected"]);
  expect(
    evaluate(KaladaV1.conditional(KaladaV1.ref("condition"), literal(1), literal(2)), {
      condition: 1,
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_OPERATOR_TYPE",
      path: ["expression", "condition"],
      message: "Kalada operator received an incompatible value.",
    },
  });
  expect(
    compileKaladaV1Program(
      KaladaV1.program(KaladaV1.conditional(literal(1), literal(1), literal(2))),
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "condition"] },
  });
});

it("preserves nested right-shaped conditionals without evaluating skipped nodes", () => {
  const right = KaladaV1.conditional(
    KaladaV1.ref("inner"),
    literal("middle"),
    KaladaV1.ref("last"),
  );
  const expression = KaladaV1.conditional(KaladaV1.ref("outer"), literal("first"), right);
  const canonical = canonicalizeKaladaV1Program(KaladaV1.program(expression));
  expect(canonical.ok && canonical.value.expression).toEqual(expression);
  const order: string[] = [];
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const result =
    compiled.ok &&
    compiled.value.evaluate((reference) => {
      order.push(reference);
      if (reference === "outer") return { found: true, value: false };
      if (reference === "inner") return { found: true, value: true };
      return { found: false };
    });
  expect(result).toEqual({ ok: true, value: "middle" });
  expect(order).toEqual(["outer", "inner"]);
});

it("collects lazy dependencies and captures in canonical child order", () => {
  const conditional = KaladaV1.conditional(
    KaladaV1.ref("condition"),
    KaladaV1.ref("then"),
    KaladaV1.ref("else"),
  );
  const coalesce = KaladaV1.optionCoalesce(KaladaV1.ref("option"), KaladaV1.ref("fallback"));
  const combined = KaladaV1.binding("choice", conditional, coalesce);
  const compiled = compileKaladaV1Program(KaladaV1.program(combined));
  expect(compiled.ok && compiled.value.dependencies).toEqual([
    "condition",
    "then",
    "else",
    "option",
    "fallback",
  ]);

  const captured = KaladaV1.binding(
    "condition",
    literal(true),
    KaladaV1.binding(
      "then",
      literal(1),
      KaladaV1.binding(
        "else",
        literal(2),
        KaladaV1.function([], KaladaV1.Type.primitive("number"), conditional),
      ),
    ),
  );
  const captureResult = compileKaladaV1Program(KaladaV1.program(captured));
  expect(captureResult.ok && captureResult.value.functions[0]?.captures).toEqual([
    "condition",
    "then",
    "else",
  ]);

  const coalesceCaptures = KaladaV1.binding(
    "option",
    KaladaV1.Option.some(literal(1)),
    KaladaV1.binding(
      "fallback",
      literal(2),
      KaladaV1.function([], KaladaV1.Type.primitive("number"), coalesce),
    ),
  );
  const coalesceCaptureResult = compileKaladaV1Program(KaladaV1.program(coalesceCaptures));
  expect(coalesceCaptureResult.ok && coalesceCaptureResult.value.functions[0]?.captures).toEqual([
    "option",
    "fallback",
  ]);
});

it("implements every conditional branch join rule", () => {
  const primitive = KaladaV1.Type.primitive;
  const equalTypes = [
    primitive("number"),
    primitive("Instant"),
    KaladaV1.Type.array(KaladaV1.Type.array(primitive("string"))),
    KaladaV1.Type.option(primitive("number")),
    KaladaV1.Type.result(primitive("number"), primitive("string")),
    KaladaV1.Type.function([primitive("number")], primitive("boolean")),
  ];
  for (const type of equalTypes)
    expect(typedConditional(type, type, type)).toMatchObject({ ok: true });
  expect(
    typedConditional(primitive("number"), primitive("string"), primitive("json")),
  ).toMatchObject({
    ok: true,
  });
  expect(
    typedConditional(
      KaladaV1.Type.array(primitive("number")),
      KaladaV1.Type.array(KaladaV1.Type.array(primitive("string"))),
      primitive("json"),
    ),
  ).toMatchObject({ ok: true });

  const dynamic = KaladaV1.function(
    [KaladaV1.parameter("condition", primitive("boolean"))],
    primitive("Duration"),
    KaladaV1.conditional(KaladaV1.ref("condition"), KaladaV1.ref("dynamic"), KaladaV1.instant(1)),
  );
  expect(compileKaladaV1Program(KaladaV1.program(dynamic))).toMatchObject({ ok: true });

  const incompatible: Array<readonly [KaladaType, KaladaType]> = [
    [
      KaladaV1.Type.option(primitive("number")),
      KaladaV1.Type.result(primitive("number"), primitive("number")),
    ],
    [primitive("Instant"), primitive("Duration")],
    [
      KaladaV1.Type.function([], primitive("number")),
      KaladaV1.Type.function([], primitive("string")),
    ],
    [
      KaladaV1.Type.array(KaladaV1.Type.option(primitive("number"))),
      KaladaV1.Type.array(primitive("number")),
    ],
  ];
  for (const [left, right] of incompatible) {
    expect(typedConditional(left, right, primitive("json"))).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "body", "else"] },
    });
  }
});

it("statically checks both branches and applies the same join to coalesce", () => {
  const invalidSkipped = KaladaV1.conditional(
    literal(false),
    KaladaV1.numericUnary("plus", literal("wrong")),
    literal(1),
  );
  expect(compileKaladaV1Program(KaladaV1.program(invalidSkipped))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "then", "operand"] },
  });
  expect(
    compileKaladaV1Program(KaladaV1.program(KaladaV1.optionCoalesce(literal(1), literal(2)))),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_OPTION_REQUIRED",
      path: ["expression", "option"],
      message: "Kalada option coalesce requires an Option value.",
    },
  });
  const joined = KaladaV1.function(
    [KaladaV1.parameter("option", KaladaV1.Type.option(KaladaV1.Type.primitive("number")))],
    KaladaV1.Type.primitive("json"),
    KaladaV1.optionCoalesce(KaladaV1.ref("option"), literal("fallback")),
  );
  expect(compileKaladaV1Program(KaladaV1.program(joined))).toMatchObject({ ok: true });
  const badJoin = KaladaV1.function(
    [KaladaV1.parameter("option", KaladaV1.Type.option(KaladaV1.Type.primitive("Instant")))],
    KaladaV1.Type.primitive("json"),
    KaladaV1.optionCoalesce(KaladaV1.ref("option"), KaladaV1.duration(1)),
  );
  expect(compileKaladaV1Program(KaladaV1.program(badJoin))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "body", "fallback"] },
  });
  expect(
    compileKaladaV1Program(
      KaladaV1.program(KaladaV1.optionCoalesce(KaladaV1.ref("dynamic"), literal(1))),
    ),
  ).toMatchObject({ ok: true });
});

it("returns every some payload unchanged and evaluates none fallback lazily", () => {
  const values: KaladaValue[] = [null, false, 0, "", [], {}];
  for (const value of values) {
    const resolve = vi.fn((reference: string) =>
      reference === "option"
        ? { found: true as const, value: Option.some(value) }
        : { found: false as const },
    );
    const compiled = compileKaladaV1Program(
      KaladaV1.program(KaladaV1.optionCoalesce(KaladaV1.ref("option"), KaladaV1.ref("fallback"))),
    );
    expect(compiled.ok && compiled.value.evaluate(resolve)).toEqual({ ok: true, value });
    expect(resolve).toHaveBeenCalledTimes(1);
  }
  const expression = KaladaV1.binding(
    "fallback",
    literal("local"),
    KaladaV1.optionCoalesce(KaladaV1.ref("option"), KaladaV1.ref("fallback")),
  );
  expect(evaluate(expression, { option: Option.none() })).toEqual({ ok: true, value: "local" });
});

it("requires a nominal Option at runtime and reports the exact option path", () => {
  const expression = KaladaV1.optionCoalesce(KaladaV1.ref("option"), literal("fallback"));
  for (const option of [Result.ok(1), { type: "Option", variant: "none" }]) {
    expect(evaluate(expression, { option: option as KaladaValue })).toMatchObject({
      ok: false,
      diagnostic: {
        code: "KALADA_OPTION_REQUIRED",
        path: ["expression", "option"],
        message: "Kalada option coalesce requires an Option value.",
      },
    });
  }
});

it("uses one reusable continuation and exact selected-node evaluation charges", () => {
  const conditional = KaladaV1.conditional(literal(true), literal(1), KaladaV1.ref("skipped"));
  expect(evaluate(conditional, {}, { maxEvaluationSteps: 3, maxContinuationFrames: 1 })).toEqual({
    ok: true,
    value: 1,
  });
  expect(evaluate(conditional, {}, { maxEvaluationSteps: 2 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression", "then"] },
  });
  const coalesce = KaladaV1.optionCoalesce(KaladaV1.ref("option"), literal(2));
  expect(
    evaluate(
      coalesce,
      { option: Option.some(1) },
      { maxEvaluationSteps: 2, maxContinuationFrames: 1 },
    ),
  ).toEqual({
    ok: true,
    value: 1,
  });
  expect(evaluate(coalesce, { option: Option.none() }, { maxEvaluationSteps: 3 })).toEqual({
    ok: true,
    value: 2,
  });
  expect(evaluate(coalesce, { option: Option.none() }, { maxEvaluationSteps: 2 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression", "fallback"] },
  });
  const nested = KaladaV1.conditional(literal(true), conditional, literal(0));
  expect(evaluate(nested, {}, { maxContinuationFrames: 1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CONTINUATION_LIMIT", path: ["expression", "then", "condition"] },
  });
  const nestedCoalesce = KaladaV1.optionCoalesce(
    KaladaV1.optionCoalesce(KaladaV1.ref("inner"), KaladaV1.Option.none()),
    literal(1),
  );
  expect(
    evaluate(nestedCoalesce, { inner: Option.none() }, { maxContinuationFrames: 1 }),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_CONTINUATION_LIMIT",
      path: ["expression", "option", "option"],
    },
  });
});

it("publishes both families in current schemas while captured old decoders reject them", () => {
  const programs = [
    KaladaV1.program(KaladaV1.conditional(literal(true), literal(1), literal(2))),
    KaladaV1.program(KaladaV1.optionCoalesce(KaladaV1.Option.none(), literal(2))),
  ];
  for (const source of [KALADA_V1_PROGRAM_SCHEMA, KALADA_V1_FUNCTION_PROGRAM_SCHEMA]) {
    const current = new Ajv2020({ strict: true }).compile(source);
    const old = new Ajv2020({ strict: true }).compile(capturedOldStrictSchema(source));
    for (const program of programs) {
      expect(current(program)).toBe(true);
      expect(old(program)).toBe(false);
    }
  }
});

function typedConditional(left: KaladaType, right: KaladaType, returns: KaladaType) {
  const expression = KaladaV1.function(
    [
      KaladaV1.parameter("condition", KaladaV1.Type.primitive("boolean")),
      KaladaV1.parameter("left", left),
      KaladaV1.parameter("right", right),
    ],
    returns,
    KaladaV1.conditional(KaladaV1.ref("condition"), KaladaV1.ref("left"), KaladaV1.ref("right")),
  );
  return compileKaladaV1Program(KaladaV1.program(expression));
}

function capturedOldStrictSchema(source: Readonly<Record<string, unknown>>): object {
  const schema = structuredClone(source) as {
    $id: string;
    $defs: { expression: { oneOf: Array<{ properties?: { kind?: { const?: string } } }> } };
  };
  schema.$id = `${schema.$id}-captured-before-control`;
  schema.$defs.expression.oneOf = schema.$defs.expression.oneOf.filter(
    (node) => !["conditional", "option-coalesce"].includes(node.properties?.kind?.const ?? ""),
  );
  return schema;
}

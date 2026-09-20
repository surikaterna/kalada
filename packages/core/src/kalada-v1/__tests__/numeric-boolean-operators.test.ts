import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, vi } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  KALADA_V1_FUNCTION_PROGRAM_SCHEMA,
  KALADA_V1_PROGRAM_SCHEMA,
  KaladaV1,
  type KaladaV1Expression,
  type KaladaValue,
} from "../index.js";

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

it("canonicalizes only the five closed numeric and boolean families", () => {
  const expressions = allOperatorExpressions();
  for (const expression of expressions) {
    const result = canonicalizeKaladaV1Program(KaladaV1.program(expression));
    expect(result).toMatchObject({ ok: true, value: { expression } });
    expect(result.ok && Object.isFrozen(result.value.expression)).toBe(true);
    expect(
      canonicalizeKaladaV1Program(KaladaV1.program({ ...expression, extra: true } as never)),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "extra"] },
    });
  }
  for (const expression of [
    { kind: "numeric-binary", operator: "^", left: literal(1), right: literal(2) },
    { kind: "numeric-unary", operator: "negative", operand: literal(1) },
    { kind: "boolean-logical", operator: "xor", left: literal(true), right: literal(false) },
  ]) {
    expect(canonicalizeKaladaV1Program(KaladaV1.program(expression as never))).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "operator"] },
    });
  }
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program({ kind: "operator", operator: "+" } as never)),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "kind"] },
  });
});

it("implements finite arithmetic, truncating remainder, and negative-zero normalization", () => {
  const binaryCases = [
    ["add", 2, 3, 5],
    ["subtract", 2, 3, -1],
    ["multiply", -2, 3, -6],
    ["divide", 7, 2, 3.5],
    ["remainder", 5, 2, 1],
    ["remainder", -5, 2, -1],
    ["remainder", 5, -2, 1],
  ] as const;
  for (const [operator, left, right, expected] of binaryCases) {
    expect(evaluate(KaladaV1.numericBinary(operator, literal(left), literal(right)))).toEqual({
      ok: true,
      value: expected,
    });
  }
  expect(evaluate(KaladaV1.numericUnary("plus", literal(4)))).toEqual({ ok: true, value: 4 });
  expect(evaluate(KaladaV1.numericUnary("negate", literal(4)))).toEqual({ ok: true, value: -4 });
  for (const expression of [
    KaladaV1.numericUnary("negate", literal(0)),
    KaladaV1.numericBinary("multiply", literal(-1), literal(0)),
    KaladaV1.numericBinary("divide", literal(0), literal(-2)),
    KaladaV1.numericBinary("remainder", literal(-4), literal(2)),
  ]) {
    const result = evaluate(expression);
    expect(result).toEqual({ ok: true, value: 0 });
    expect(result.ok && Object.is(result.value, -0)).toBe(false);
  }
});

it("uses stable zero-divisor and non-finite diagnostics", () => {
  for (const operator of ["divide", "remainder"] as const) {
    for (const divisor of [0, -0]) {
      expect(
        evaluate(KaladaV1.numericBinary(operator, literal(1), literal(divisor))),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          code: "KALADA_NUMERIC_ZERO_DIVISOR",
          path: ["expression", "right"],
          message: "Kalada numeric divisor must not be zero.",
        },
      });
    }
  }
  expect(
    evaluate(KaladaV1.numericBinary("multiply", literal(Number.MAX_VALUE), literal(2))),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_NUMERIC_NON_FINITE",
      path: ["expression"],
      message: "Kalada numeric operation produced a non-finite value.",
    },
  });
});

it("rejects non-numeric operands without coercion at the exact operand path", () => {
  const staticCases = [
    KaladaV1.numericBinary("add", literal("1"), literal(2)),
    KaladaV1.numericBinary("multiply", literal(1), literal(true)),
    KaladaV1.numericUnary("plus", literal("1")),
  ];
  const paths = [
    ["expression", "left"],
    ["expression", "right"],
    ["expression", "operand"],
  ];
  staticCases.forEach((expression, index) => {
    expect(compileKaladaV1Program(KaladaV1.program(expression))).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_OPERATOR_TYPE", path: paths[index] },
    });
  });
  const dynamic = KaladaV1.numericBinary("add", literal(1), KaladaV1.ref("right"));
  expect(evaluate(dynamic, { right: "2" })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "right"] },
  });
  expect(
    canonicalizeKaladaV1Program(
      KaladaV1.program(KaladaV1.numericUnary("plus", literal(Number.POSITIVE_INFINITY))),
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "operand", "value"] },
  });
});

it("implements strict not, lazy logical operators, and eager exclusive xor", () => {
  expect(evaluate(KaladaV1.booleanNot(literal(true)))).toEqual({ ok: true, value: false });
  for (const [left, right] of [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const) {
    expect(evaluate(KaladaV1.booleanLogical("and", literal(left), literal(right)))).toEqual({
      ok: true,
      value: left && right,
    });
    expect(evaluate(KaladaV1.booleanLogical("or", literal(left), literal(right)))).toEqual({
      ok: true,
      value: left || right,
    });
    expect(evaluate(KaladaV1.booleanXor(literal(left), literal(right)))).toEqual({
      ok: true,
      value: left !== right,
    });
  }
  expect(evaluate(KaladaV1.booleanNot(KaladaV1.ref("value")), { value: 1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "operand"] },
  });
  expect(
    evaluate(KaladaV1.booleanLogical("and", literal(true), KaladaV1.ref("right")), { right: 1 }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "right"] },
  });
});

it("short-circuits logical right operands but evaluates xor left-to-right exactly once", () => {
  for (const [operator, left, expected] of [
    ["and", false, false],
    ["or", true, true],
  ] as const) {
    const resolve = vi.fn((reference: string) =>
      reference === "left" ? { found: true as const, value: left } : { found: false as const },
    );
    const expression = KaladaV1.booleanLogical(
      operator,
      KaladaV1.ref("left"),
      KaladaV1.ref("skipped"),
    );
    const compiled = compileKaladaV1Program(KaladaV1.program(expression));
    expect(compiled.ok && compiled.value.dependencies).toEqual(["left", "skipped"]);
    expect(compiled.ok && compiled.value.evaluate(resolve)).toEqual({ ok: true, value: expected });
    expect(resolve).toHaveBeenCalledTimes(1);
  }
  const order: string[] = [];
  const xor = compileKaladaV1Program(
    KaladaV1.program(KaladaV1.booleanXor(KaladaV1.ref("left"), KaladaV1.ref("right"))),
  );
  expect(
    xor.ok &&
      xor.value.evaluate((reference) => {
        order.push(reference);
        return { found: true, value: reference === "left" };
      }),
  ).toEqual({ ok: true, value: true });
  expect(order).toEqual(["left", "right"]);
});

it("analyzes all boolean operands and records captures independently of lazy runtime paths", () => {
  const invalidRight = KaladaV1.booleanLogical("and", literal(false), literal(1));
  expect(compileKaladaV1Program(KaladaV1.program(invalidRight))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "right"] },
  });
  const boolean = KaladaV1.Type.primitive("boolean");
  const captured = KaladaV1.binding(
    "left",
    literal(false),
    KaladaV1.function(
      [],
      boolean,
      KaladaV1.booleanLogical("and", KaladaV1.ref("left"), KaladaV1.ref("external")),
    ),
  );
  const compiled = compileKaladaV1Program(KaladaV1.program(captured));
  expect(compiled.ok && compiled.value.functions[0]?.captures).toEqual(["left"]);
  expect(compiled.ok && compiled.value.dependencies).toEqual(["external"]);

  const numeric = compileKaladaV1Program(
    KaladaV1.program(
      KaladaV1.numericBinary(
        "add",
        KaladaV1.numericUnary("plus", KaladaV1.ref("first")),
        KaladaV1.ref("second"),
      ),
    ),
  );
  expect(numeric.ok && numeric.value.dependencies).toEqual(["first", "second"]);
});

it("evaluates numeric operands left-to-right once and applies AST bounds to every child", () => {
  const expression = KaladaV1.numericBinary("add", KaladaV1.ref("left"), KaladaV1.ref("right"));
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const order: string[] = [];
  const outcome =
    compiled.ok &&
    compiled.value.evaluate((reference) => {
      order.push(reference);
      return { found: true, value: reference === "left" ? 1 : 2 };
    });
  expect(outcome).toEqual({ ok: true, value: 3 });
  expect(order).toEqual(["left", "right"]);

  const nested = KaladaV1.numericUnary("plus", KaladaV1.numericUnary("plus", literal(1)));
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(nested), {
      limits: { maxAstDepth: 2, maxAstNodes: 3 },
    }),
  ).toMatchObject({ ok: true });
  expect(
    canonicalizeKaladaV1Program(KaladaV1.program(nested), {
      limits: { maxAstDepth: 1, maxAstNodes: 3 },
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_LIMIT_EXCEEDED",
      path: ["expression", "operand", "operand"],
    },
  });
});

it("accounts deterministically for skipped steps and dedicated continuation frames", () => {
  const skipped = KaladaV1.booleanLogical("and", literal(false), KaladaV1.ref("right"));
  expect(evaluate(skipped, {}, { maxEvaluationSteps: 2, maxContinuationFrames: 1 })).toEqual({
    ok: true,
    value: false,
  });
  const evaluated = KaladaV1.booleanLogical("and", literal(true), literal(true));
  expect(evaluate(evaluated, {}, { maxEvaluationSteps: 3, maxContinuationFrames: 1 })).toEqual({
    ok: true,
    value: true,
  });
  expect(evaluate(evaluated, {}, { maxEvaluationSteps: 2 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression", "right"] },
  });
  const nested = KaladaV1.booleanNot(KaladaV1.booleanNot(literal(true)));
  expect(evaluate(nested, {}, { maxContinuationFrames: 1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CONTINUATION_LIMIT", path: ["expression", "operand", "operand"] },
  });
});

it("publishes every new operator in both schemas while captured old schemas reject them", () => {
  const programs = allOperatorExpressions().map(KaladaV1.program);
  for (const source of [KALADA_V1_PROGRAM_SCHEMA, KALADA_V1_FUNCTION_PROGRAM_SCHEMA]) {
    const current = new Ajv2020({ strict: true }).compile(source);
    const old = new Ajv2020({ strict: true }).compile(capturedOldStrictSchema(source));
    expect(old(KaladaV1.program(literal(1)))).toBe(true);
    for (const program of programs) {
      expect(current(program)).toBe(true);
      expect(old(program)).toBe(false);
    }
  }
});

function allOperatorExpressions(): KaladaV1Expression[] {
  const expressions: KaladaV1Expression[] = [];
  for (const operator of ["add", "subtract", "multiply", "divide", "remainder"] as const) {
    expressions.push(KaladaV1.numericBinary(operator, literal(4), literal(2)));
  }
  for (const operator of ["plus", "negate"] as const) {
    expressions.push(KaladaV1.numericUnary(operator, literal(2)));
  }
  expressions.push(KaladaV1.booleanNot(literal(true)));
  for (const operator of ["and", "or"] as const) {
    expressions.push(KaladaV1.booleanLogical(operator, literal(true), literal(false)));
  }
  expressions.push(KaladaV1.booleanXor(literal(true), literal(false)));
  return expressions;
}

function literal(value: string | number | boolean): KaladaV1Expression {
  return KaladaV1.literal(value);
}

function capturedOldStrictSchema(source: Readonly<Record<string, unknown>>): object {
  const schema = structuredClone(source) as {
    $id: string;
    $defs: { expression: { oneOf: Array<{ properties?: { kind?: { const?: string } } }> } };
  };
  schema.$id = `${schema.$id}-captured-before-numeric-boolean`;
  const newKinds = new Set([
    "numeric-binary",
    "numeric-unary",
    "boolean-not",
    "boolean-logical",
    "boolean-xor",
  ]);
  schema.$defs.expression.oneOf = schema.$defs.expression.oneOf.filter(
    (node) => !newKinds.has(node.properties?.kind?.const ?? ""),
  );
  return schema;
}

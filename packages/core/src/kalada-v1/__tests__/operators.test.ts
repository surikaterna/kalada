import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, vi } from "vitest";
import {
  canonicalizeKaladaV1Program,
  compileKaladaV1Program,
  Duration,
  Instant,
  KALADA_V1_FUNCTION_PROGRAM_SCHEMA,
  KALADA_V1_PROGRAM_SCHEMA,
  KaladaV1,
  type KaladaV1Expression,
  type KaladaValue,
  Option,
  Result,
} from "../index.js";

const missing = () => ({ found: false as const });

function evaluate(
  expression: KaladaV1Expression,
  values: Readonly<Record<string, KaladaValue>> = {},
  limits: {
    maxEvaluationSteps?: number;
    maxContinuationFrames?: number;
    maxValueDepth?: number;
  } = {},
) {
  const compiled = compileKaladaV1Program(KaladaV1.program(expression), { limits });
  if (!compiled.ok) return compiled;
  return compiled.value.evaluate((reference) =>
    reference in values
      ? { found: true, value: values[reference] as KaladaValue }
      : { found: false },
  );
}

it("canonicalizes exact closed operator families and rejects malformed selectors", () => {
  const expressions = [
    KaladaV1.equality("equal", KaladaV1.literal(1), KaladaV1.literal(1)),
    KaladaV1.orderedComparison("string", "less-than", KaladaV1.literal("a"), KaladaV1.literal("b")),
    KaladaV1.membership(KaladaV1.literal(1), KaladaV1.literal([1, 2])),
  ];
  for (const expression of expressions) {
    const result = canonicalizeKaladaV1Program(KaladaV1.program(expression));
    expect(result).toMatchObject({ ok: true, value: { expression } });
    expect(result.ok && Object.isFrozen(result.value.expression)).toBe(true);
  }
  for (const expression of expressions) {
    expect(
      canonicalizeKaladaV1Program(KaladaV1.program({ ...expression, extra: true } as never)),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "extra"] },
    });
  }
  expect(
    canonicalizeKaladaV1Program(
      KaladaV1.program({
        kind: "ordered-comparison",
        domain: "temporal",
        operator: "less-than",
        left: KaladaV1.literal(1),
        right: KaladaV1.literal(2),
      } as never),
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_INVALID_INPUT", path: ["expression", "domain"] },
  });
});

it("implements strict deep equality across JSON, ADTs, and temporal values", () => {
  const cases: Array<readonly [KaladaValue, KaladaValue, boolean]> = [
    [1, 1, true],
    [1, "1", false],
    [[1, { nested: true }], [1, { nested: true }], true],
    [[1, 2], [2, 1], false],
    [{ a: 1, b: [2] }, { b: [2], a: 1 }, true],
    [Option.some(Result.ok({ nested: [1] })), Option.some(Result.ok({ nested: [1] })), true],
    [Option.none(), Option.some(null), false],
    [Result.ok(1), Result.err(1), false],
    [Instant.fromMilliseconds(10), Instant.fromMilliseconds(10), true],
    [Instant.fromMilliseconds(10), Duration.fromMilliseconds(10), false],
  ];
  for (const [left, right, expected] of cases) {
    const expression = KaladaV1.equality("equal", KaladaV1.ref("left"), KaladaV1.ref("right"));
    expect(evaluate(expression, { left, right })).toEqual({ ok: true, value: expected });
    const notEqual = KaladaV1.equality("not-equal", KaladaV1.ref("left"), KaladaV1.ref("right"));
    expect(evaluate(notEqual, { left, right })).toEqual({ ok: true, value: !expected });
  }
});

it("compares strings by exact UTF-16 code units and numbers by numeric order", () => {
  const ordered = (
    domain: "number" | "string",
    operator: "less-than" | "less-than-or-equal" | "greater-than" | "greater-than-or-equal",
    left: number | string,
    right: number | string,
  ) =>
    evaluate(
      KaladaV1.orderedComparison(domain, operator, KaladaV1.literal(left), KaladaV1.literal(right)),
    );
  expect(ordered("string", "less-than", "a", "aa")).toEqual({ ok: true, value: true });
  expect(ordered("string", "less-than", "😀", "\uE000")).toEqual({ ok: true, value: true });
  expect(ordered("string", "greater-than", "A", "a")).toEqual({ ok: true, value: false });
  expect(ordered("string", "less-than-or-equal", "same", "same")).toEqual({
    ok: true,
    value: true,
  });
  expect(ordered("number", "greater-than", 2, -1)).toEqual({ ok: true, value: true });
  expect(ordered("number", "greater-than-or-equal", 2, 2)).toEqual({ ok: true, value: true });
});

it("selects ordering from one known operand and rejects invalid or ambiguous static pairs", () => {
  const selected = KaladaV1.orderedComparison(
    "number",
    "less-than",
    KaladaV1.literal(1),
    KaladaV1.ref("dynamic"),
  );
  expect(evaluate(selected, { dynamic: 2 })).toEqual({ ok: true, value: true });
  expect(evaluate(selected, { dynamic: "2" })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "right"] },
  });
  const ambiguous = KaladaV1.orderedComparison(
    "number",
    "less-than",
    KaladaV1.ref("left"),
    KaladaV1.ref("right"),
  );
  expect(compileKaladaV1Program(KaladaV1.program(ambiguous))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_AMBIGUOUS", path: ["expression", "operator"] },
  });
  const invalid = KaladaV1.orderedComparison(
    "number",
    "less-than",
    KaladaV1.literal(1),
    KaladaV1.literal("2"),
  );
  expect(compileKaladaV1Program(KaladaV1.program(invalid))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "right"] },
  });
});

it("performs array-only membership with canonical deep equality", () => {
  const membership = KaladaV1.membership(KaladaV1.ref("needle"), KaladaV1.ref("array"));
  expect(evaluate(membership, { needle: { b: 2, a: 1 }, array: [{ a: 1, b: 2 }] })).toEqual({
    ok: true,
    value: true,
  });
  expect(
    evaluate(membership, {
      needle: [1, 2],
      array: [
        [2, 1],
        [1, 2],
      ],
    }),
  ).toEqual({
    ok: true,
    value: true,
  });
  expect(evaluate(membership, { needle: Option.none(), array: [null] })).toEqual({
    ok: true,
    value: false,
  });
  expect(evaluate(membership, { needle: 1, array: { key: 1 } })).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_OPERATOR_TYPE",
      path: ["expression", "array"],
      message: "Kalada operator received an incompatible value.",
    },
  });
  expect(
    compileKaladaV1Program(
      KaladaV1.program(KaladaV1.membership(KaladaV1.literal("x"), KaladaV1.literal("text"))),
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "array"] },
  });
});

it("rejects known and dynamically selected callables at the first operand", () => {
  const number = KaladaV1.Type.primitive("number");
  const callable = KaladaV1.function([], number, KaladaV1.literal(1));
  for (const expression of [
    KaladaV1.equality("equal", callable, KaladaV1.literal(1)),
    KaladaV1.membership(callable, KaladaV1.literal([])),
  ]) {
    expect(compileKaladaV1Program(KaladaV1.program(expression))).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_OPERATOR_TYPE" },
    });
  }
  const callableArray = KaladaV1.function(
    [KaladaV1.parameter("items", KaladaV1.Type.array(KaladaV1.Type.function([], number)))],
    KaladaV1.Type.primitive("boolean"),
    KaladaV1.membership(KaladaV1.literal(1), KaladaV1.ref("items")),
  );
  expect(compileKaladaV1Program(KaladaV1.program(callableArray))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "body", "array"] },
  });
  const hiddenCallable = KaladaV1.match("Option", KaladaV1.ref("choice"), [
    KaladaV1.arm("some", KaladaV1.ref("payload"), "payload"),
    KaladaV1.arm("none", callable),
  ]);
  const resolve = vi.fn((reference: string) =>
    reference === "choice"
      ? { found: true as const, value: Option.none() }
      : { found: false as const },
  );
  const compiled = compileKaladaV1Program(
    KaladaV1.program(KaladaV1.equality("equal", hiddenCallable, KaladaV1.ref("right"))),
  );
  expect(compiled.ok && compiled.value.evaluate(resolve)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_OPERATOR_TYPE", path: ["expression", "left"] },
  });
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("evaluates operands once in canonical order and records dependencies and captures", () => {
  const expression = KaladaV1.membership(KaladaV1.ref("needle"), KaladaV1.ref("array"));
  const compiled = compileKaladaV1Program(KaladaV1.program(expression));
  const order: string[] = [];
  const resolve = vi.fn((reference: string) => {
    order.push(reference);
    return reference === "needle"
      ? { found: true as const, value: 2 }
      : { found: true as const, value: [1, 2] };
  });
  expect(compiled.ok && compiled.value.dependencies).toEqual(["needle", "array"]);
  expect(compiled.ok && compiled.value.evaluate(resolve)).toEqual({ ok: true, value: true });
  expect(order).toEqual(["needle", "array"]);

  const boolean = KaladaV1.Type.primitive("boolean");
  const captured = KaladaV1.binding(
    "left",
    KaladaV1.literal(1),
    KaladaV1.function(
      [],
      boolean,
      KaladaV1.equality("equal", KaladaV1.ref("left"), KaladaV1.ref("external")),
    ),
  );
  const captureResult = compileKaladaV1Program(KaladaV1.program(captured));
  expect(captureResult.ok && captureResult.value.functions[0]?.captures).toEqual(["left"]);
  expect(captureResult.ok && captureResult.value.dependencies).toEqual(["external"]);
});

it("uses one continuation and charges every deep comparison pair", () => {
  const equality = KaladaV1.equality("equal", KaladaV1.literal([1, 2]), KaladaV1.literal([1, 2]));
  expect(evaluate(equality, {}, { maxContinuationFrames: 1, maxEvaluationSteps: 6 })).toEqual({
    ok: true,
    value: true,
  });
  expect(evaluate(equality, {}, { maxEvaluationSteps: 5 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression"] },
  });
  const nested = KaladaV1.equality("equal", equality, KaladaV1.literal(true));
  expect(evaluate(nested, {}, { maxContinuationFrames: 1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CONTINUATION_LIMIT", path: ["expression", "left", "left"] },
  });
});

it("compares deeply nested ADTs without host recursion", () => {
  let left: KaladaValue = 1;
  let right: KaladaValue = 1;
  for (let index = 0; index < 200; index += 1) {
    left = Option.some(left);
    right = Option.some(right);
  }
  const expression = KaladaV1.equality("equal", KaladaV1.ref("left"), KaladaV1.ref("right"));
  expect(
    evaluate(expression, { left, right }, { maxValueDepth: 256, maxEvaluationSteps: 300 }),
  ).toEqual({
    ok: true,
    value: true,
  });
});

it("publishes new nodes in both schemas while captured old schemas reject every family", () => {
  const programs = [
    KaladaV1.program(KaladaV1.equality("equal", KaladaV1.literal(1), KaladaV1.literal(1))),
    KaladaV1.program(
      KaladaV1.orderedComparison("number", "less-than", KaladaV1.literal(1), KaladaV1.literal(2)),
    ),
    KaladaV1.program(KaladaV1.membership(KaladaV1.literal(1), KaladaV1.literal([1]))),
  ];
  for (const source of [KALADA_V1_PROGRAM_SCHEMA, KALADA_V1_FUNCTION_PROGRAM_SCHEMA]) {
    const current = new Ajv2020({ strict: true }).compile(source);
    const old = new Ajv2020({ strict: true }).compile(capturedOldStrictSchema(source));
    expect(old(KaladaV1.program(KaladaV1.literal(1)))).toBe(true);
    for (const program of programs) {
      expect(current(program)).toBe(true);
      expect(old(program)).toBe(false);
    }
  }
});

it("preserves representative existing v1 outcomes", () => {
  const existing = KaladaV1.program(
    KaladaV1.temporalComparison("less-than", KaladaV1.instant(1), KaladaV1.instant(2)),
  );
  expect(canonicalizeKaladaV1Program(existing)).toMatchObject({ ok: true, value: existing });
  const compiled = compileKaladaV1Program(existing);
  expect(compiled.ok && compiled.value.evaluate(missing)).toEqual({ ok: true, value: true });
});

function capturedOldStrictSchema(source: Readonly<Record<string, unknown>>): object {
  const schema = structuredClone(source) as {
    $id: string;
    $defs: { expression: { oneOf: Array<{ properties?: { kind?: { const?: string } } }> } };
  };
  schema.$id = `${schema.$id}-captured-before-operators`;
  const newKinds = new Set([
    "field-access",
    "optional-field-access",
    "equality",
    "ordered-comparison",
    "membership",
  ]);
  schema.$defs.expression.oneOf = schema.$defs.expression.oneOf.filter(
    (node) => !newKinds.has(node.properties?.kind?.const ?? ""),
  );
  return schema;
}

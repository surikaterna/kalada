import { expect, test } from "vitest";
import {
  compileExpression,
  ExpressionProfileBuilder,
  type JsonValue,
  standardV1,
  type ValueExpression,
} from "../index.js";
import { literal, op } from "./helpers.js";

function evaluate(expression: ValueExpression, resolver = () => ({ found: false as const })) {
  const compiled = compileExpression(expression, { profile: standardV1 });
  expect(compiled.ok).toBe(true);
  return compiled.ok ? compiled.value.evaluate(resolver) : compiled;
}

test.each([
  ["eq", { a: [1, { b: true }] }, { b: 0 }, false],
  ["eq", { a: [1, { b: true }] }, { a: [1, { b: true }] }, true],
  ["neq", 1, "1", true],
  ["gt", "b", "a", true],
  ["lte", 2, 2, true],
  ["in", { x: 1 }, [{ x: 1 }], true],
  ["nin", null, [1, 2], true],
])("evaluates strict %s", (name, left, right, expected) => {
  expect(evaluate(op(name, literal(left as JsonValue), literal(right as JsonValue)))).toEqual({
    ok: true,
    value: expected,
  });
});

test("rejects mixed comparison types and invalid membership", () => {
  expect(evaluate(op("gt", literal(2), literal("1")))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_TYPE_MISMATCH" },
  });
  expect(evaluate(op("in", literal(2), literal(2)))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_TYPE_MISMATCH" },
  });
});

test.each([
  ["add", 4, 2, 6],
  ["sub", 4, 2, 2],
  ["mul", 4, 2, 8],
  ["div", 4, 2, 2],
])("evaluates finite %s", (name, left, right, expected) => {
  expect(evaluate(op(name, literal(left), literal(right)))).toEqual({
    ok: true,
    value: expected,
  });
});

test("diagnoses division by either zero and non-finite arithmetic", () => {
  for (const zero of [0, -0]) {
    expect(evaluate(op("div", literal(1), literal(zero)))).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_DIVISION_BY_ZERO" },
    });
  }
  expect(evaluate(op("mul", literal(Number.MAX_VALUE), literal(2)))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_NON_FINITE_RESULT" },
  });
});

test("validates exact, minimum, and maximum arity during compilation", () => {
  expect(
    compileExpression(op("not", literal(true), literal(false)), { profile: standardV1 }),
  ).toMatchObject({ ok: false, diagnostic: { code: "EXPRESSION_INVALID_ARITY" } });
  expect(compileExpression(op("and"), { profile: standardV1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_INVALID_ARITY" },
  });
  const profile = new ExpressionProfileBuilder("bounded")
    .add({ name: "app:pick", minArgs: 1, maxArgs: 2, execute: ([first]) => first! })
    .build();
  expect(
    compileExpression(op("app:pick", literal(1), literal(2), literal(3)), { profile }),
  ).toMatchObject({ ok: false, diagnostic: { code: "EXPRESSION_INVALID_ARITY" } });
  for (const args of [
    [],
    [literal(true)],
    [literal(true), literal(1)],
    [literal(true), literal(1), literal(2), literal(3)],
  ]) {
    expect(compileExpression(op("if", ...args), { profile: standardV1 })).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_ARITY" },
    });
  }
});

test("selects arbitrary JSON values from strict boolean if branches", () => {
  expect(evaluate(op("if", literal(true), literal({ selected: [1] }), literal("no")))).toEqual({
    ok: true,
    value: { selected: [1] },
  });
  expect(evaluate(op("if", literal(false), literal("no"), literal([null, true])))).toEqual({
    ok: true,
    value: [null, true],
  });
  expect(evaluate(op("if", literal(1), literal("yes"), literal("no")))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_TYPE_MISMATCH", path: ["args", 0] },
  });
});

test("validates both if branches even when one would be unselected", () => {
  expect(
    compileExpression(
      {
        kind: "op",
        op: "if",
        args: [literal(true), literal(1), { kind: "op", op: "unknown", args: [] }],
      },
      { profile: standardV1 },
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_UNKNOWN_OPERATOR", path: ["args", 2, "op"] },
  });
});

test("rejects unknown operators at compile time", () => {
  expect(compileExpression(op("unknown"), { profile: standardV1 })).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_UNKNOWN_OPERATOR", path: ["op"] },
  });
});

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  canonicalizeExpression,
  ExpressionProfile,
  ExpressionProfileBuilder,
  generateExpressionJsonSchema,
  getStandardExpressionJsonSchema,
  standardV1,
} from "../index.js";
import { literal, op, ref } from "./helpers.js";

describe("expression JSON Schema", () => {
  const compileSchema = (schema: object) => new Ajv2020({ strict: true }).compile(schema);

  test("describes strict profile-aware operator nodes and JSON-only values", () => {
    const schema = generateExpressionJsonSchema(standardV1) as any;
    expect(getStandardExpressionJsonSchema()).toEqual(schema);
    const variants = schema.$defs.expression.oneOf;
    const add = variants.find((candidate: any) => candidate.properties?.op?.const === "add");
    const and = variants.find((candidate: any) => candidate.properties?.op?.const === "and");
    expect(add.properties.args).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(and.properties.args).toMatchObject({ minItems: 1, maxItems: 32 });
    expect(add.additionalProperties).toBe(false);
    expect(schema.$defs.jsonValue.anyOf.map((candidate: any) => candidate.type)).toEqual([
      "null",
      "boolean",
      "number",
      "string",
      "array",
      "object",
    ]);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(schema.$comment).toContain("aggregate maxNodes and maxDepth");
  });

  test("returns deeply frozen schemas without shared mutable state", () => {
    const first = getStandardExpressionJsonSchema() as any;
    const variants = first.$defs.jsonValue.anyOf;
    expect(Object.isFrozen(first.$defs)).toBe(true);
    expect(Object.isFrozen(first.$defs.jsonValue)).toBe(true);
    expect(Object.isFrozen(variants)).toBe(true);
    expect(Object.isFrozen(variants[0])).toBe(true);
    expect(() => variants.push({ type: "undefined" })).toThrow(TypeError);
    expect((getStandardExpressionJsonSchema() as any).$defs.jsonValue.anyOf).toHaveLength(6);
  });

  test("AJV accepts representative standard expressions and rejects runtime-invalid shapes", () => {
    const validate = compileSchema(getStandardExpressionJsonSchema());
    for (const name of standardV1.definitions.map(({ name }) => name)) {
      const definition = standardV1.get(name)!;
      const count = definition.arity ?? definition.minArgs ?? 0;
      expect(validate(op(name, ...Array.from({ length: count }, () => literal(null))))).toBe(true);
    }
    expect(validate(op("unknown", literal(1)))).toBe(false);
    expect(validate(op("add", literal(1)))).toBe(false);
    expect(validate({ kind: "ref", ref: "x", extra: true })).toBe(false);
    expect(validate({ kind: "literal", value: Number.POSITIVE_INFINITY })).toBe(false);
    expect(validate(op("and", ...Array.from({ length: 33 }, () => literal(true))))).toBe(false);
    expect(validate(literal({ ["x".repeat(10_001)]: true }))).toBe(false);
  });

  test("matches JSON Schema code-point length semantics for string values and property keys", () => {
    const validate = compileSchema(getStandardExpressionJsonSchema());
    const limit = 10_000;
    const mixed = `${"😀".repeat(limit / 2)}${"a".repeat(limit / 2)}`;
    const cases: readonly [string, string, boolean][] = [
      ["BMP exact", "a".repeat(limit), true],
      ["BMP over", "a".repeat(limit + 1), false],
      ["astral exact", "😀".repeat(limit), true],
      ["astral over", "😀".repeat(limit + 1), false],
      ["mixed exact", mixed, true],
      ["mixed over", `${mixed}a`, false],
      ["unpaired surrogate exact", "\ud800".repeat(limit), true],
      ["unpaired surrogate over", "\ud800".repeat(limit + 1), false],
    ];
    for (const [_name, value, expected] of cases) {
      const valueExpression = literal(value);
      const keyExpression = literal({ [value]: true });
      expect(validate(valueExpression)).toBe(expected);
      expect(canonicalizeExpression(valueExpression).ok).toBe(expected);
      expect(validate(keyExpression)).toBe(expected);
      expect(canonicalizeExpression(keyExpression).ok).toBe(expected);
    }
  });

  test("leaves aggregate node and depth enforcement authoritative at runtime", () => {
    const schema = generateExpressionJsonSchema(new ExpressionProfile("literal-only", []));
    const validate = compileSchema(schema);
    const value = { left: [1, 2], right: [3, 4] };
    const expression = literal(value);
    expect(validate(expression)).toBe(true);
    expect(canonicalizeExpression(expression, { limits: { maxNodes: 5 } })).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED" },
    });
    expect(canonicalizeExpression(literal([[[true]]]), { limits: { maxDepth: 2 } })).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED" },
    });
  });

  test("includes only supplied custom profile operators and their arity", () => {
    const custom = new ExpressionProfileBuilder("custom")
      .add({ name: "app:pick", minArgs: 1, maxArgs: 2, execute: ([value]) => value! })
      .build();
    const schema = generateExpressionJsonSchema(custom) as any;
    const validate = compileSchema(schema);
    const operators = schema.$defs.expression.oneOf
      .map((candidate: any) => candidate.properties?.op?.const)
      .filter(Boolean);
    expect(operators).toEqual(["app:pick"]);
    expect(schema.$defs.expression.oneOf[2].properties.args).toMatchObject({
      minItems: 1,
      maxItems: 2,
    });
    expect(validate(op("app:pick", literal(1)))).toBe(true);
    expect(validate(op("add", literal(1), literal(2)))).toBe(false);
  });

  test("supports profiles with no operator nodes", () => {
    const validate = compileSchema(
      generateExpressionJsonSchema(new ExpressionProfile("literal-only", [])),
    );
    expect(validate(literal(1))).toBe(true);
    expect(validate(ref("x"))).toBe(true);
    expect(validate(op("anything"))).toBe(false);
  });
});

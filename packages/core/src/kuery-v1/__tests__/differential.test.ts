import * as upstream from "kuery/expression";
import { describe, expect, test } from "vitest";
import * as extracted from "../index.js";
import { literal, op, ref } from "./helpers.js";

const expressions = [
  literal({ z: [1, null], a: true }),
  ref("score"),
  op("eq", literal({ a: [1] }), literal({ a: [1] })),
  op("neq", literal(1), literal("1")),
  op("gt", literal("b"), literal("a")),
  op("add", literal(4), literal(2)),
  op("div", literal(1), literal(0)),
  op("and", literal(false), ref("unread")),
  op("or", literal(true), ref("unread")),
  op("coalesce", ref("missing"), literal(7)),
  op("exists", ref("missing")),
  op("if", literal(true), literal("yes"), ref("unread")),
] as const;

const resolve = (reference: string) =>
  reference === "score" ? { found: true as const, value: 3 } : { found: false as const };

function runExtracted(expression: unknown): unknown {
  const compiled = extracted.compileExpression(expression, { profile: extracted.standardV1 });
  return compiled.ok ? compiled.value.evaluate(resolve) : compiled;
}

function runUpstream(expression: unknown): unknown {
  const compiled = upstream.compileExpression(expression, { profile: upstream.standardV1 });
  return compiled.ok ? compiled.value.evaluate(resolve) : compiled;
}

function operatorMetadata(
  definitions: readonly { readonly execute: unknown }[],
): readonly Record<string, unknown>[] {
  return definitions.map(({ execute: _execute, ...metadata }) => metadata);
}

describe("Kuery 2.1 differential parity", () => {
  test("matches the exact runtime export names", () => {
    expect(Object.keys(extracted).sort()).toEqual(Object.keys(upstream).sort());
  });

  test.each(expressions)(
    "matches canonicalization, compilation, and evaluation for %#",
    (value) => {
      expect(extracted.canonicalizeExpression(value)).toEqual(
        upstream.canonicalizeExpression(value),
      );
      expect(runExtracted(value)).toEqual(runUpstream(value));
    },
  );

  test("matches profile metadata, limits, and schema IDs", () => {
    expect(extracted.DEFAULT_EXPRESSION_LIMITS).toEqual(upstream.DEFAULT_EXPRESSION_LIMITS);
    expect(extracted.standardV1.name).toBe(upstream.standardV1.name);
    expect(operatorMetadata(extracted.standardV1.definitions)).toEqual(
      operatorMetadata(upstream.standardV1.definitions),
    );
    expect(extracted.getStandardExpressionJsonSchema()).toEqual(
      upstream.getStandardExpressionJsonSchema(),
    );
  });
});

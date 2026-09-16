import { describe, expect, test } from "vitest";
import { canonicalizeKaladaProgramV1, fromKueryExpression, toKueryExpression } from "./index.js";

const expression = { kind: "literal", value: { z: 1, a: true } };

describe("KaladaProgramV1", () => {
  test("canonicalizes the exact four-field envelope and deeply freezes its expression", () => {
    const result = canonicalizeKaladaProgramV1({
      format: "kalada-program",
      version: 1,
      profile: "standard-v1",
      expression,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        format: "kalada-program",
        version: 1,
        profile: "standard-v1",
        expression: { kind: "literal", value: { a: true, z: 1 } },
      },
    });
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.expression)).toBe(true);
    }
  });

  test.each([
    {},
    { format: "other", version: 1, profile: "standard-v1", expression },
    { format: "kalada-program", version: 2, profile: "standard-v1", expression },
    { format: "kalada-program", version: 1, profile: "other", expression },
    { format: "kalada-program", version: 1, profile: "standard-v1", expression, extra: true },
  ])("rejects non-contract envelopes", (input) => {
    expect(canonicalizeKaladaProgramV1(input)).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_INPUT" },
    });
  });

  test("round trips Kuery expressions and prefixes envelope diagnostic paths", () => {
    const program = fromKueryExpression(expression);
    expect(program.ok).toBe(true);
    expect(program.ok && toKueryExpression(program.value)).toEqual({
      ok: true,
      value: { kind: "literal", value: { a: true, z: 1 } },
    });
    expect(
      canonicalizeKaladaProgramV1({
        format: "kalada-program",
        version: 1,
        profile: "standard-v1",
        expression: { kind: "ref", ref: "" },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_REFERENCE", path: ["expression", "ref"] },
    });
  });

  test("does not invoke envelope accessors", () => {
    let invoked = false;
    const input = Object.defineProperty(
      { format: "kalada-program", version: 1, profile: "standard-v1" },
      "expression",
      { enumerable: true, get: () => (invoked = true) },
    );
    expect(canonicalizeKaladaProgramV1(input)).toMatchObject({ ok: false });
    expect(invoked).toBe(false);
  });
});

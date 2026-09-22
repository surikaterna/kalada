import { describe, expect, it } from "vitest";
import { admitSchema, estimateValidationWork, SchemaAdmissionError } from "./admission.js";

describe("demo-json-2020-12-v1 admission", () => {
  it.each([
    true,
    false,
    { type: "string", minLength: 1, maxLength: 4 },
    { type: ["number", "null"], minimum: 0, maximum: 10 },
    { type: "array", prefixItems: [{ type: "string" }], items: false, maxItems: 1 },
    {
      type: "object",
      properties: { value: { $ref: "#/$defs/value" } },
      required: ["value"],
      additionalProperties: false,
      $defs: { value: { enum: [1, 2, 3] } },
    },
    { anyOf: [{ type: "string" }, { type: "boolean" }] },
    { allOf: [{ type: "number" }, { minimum: 0 }] },
  ])("accepts the documented profile: %j", (schema) => {
    expect(admitSchema(schema).nodeCount).toBeGreaterThan(0);
  });

  it.each([
    [{ format: "email" }, "SCHEMA_UNSUPPORTED_KEYWORD"],
    [{ $id: "urn:no" }, "SCHEMA_UNSUPPORTED_KEYWORD"],
    [{ unevaluatedProperties: false }, "SCHEMA_UNSUPPORTED_KEYWORD"],
    [{ $dynamicRef: "#x" }, "SCHEMA_UNSUPPORTED_KEYWORD"],
    [{ $ref: "https://example.invalid/schema" }, "SCHEMA_REF_EXTERNAL"],
    [{ $ref: "other.json#/value" }, "SCHEMA_REF_EXTERNAL"],
    [{ $ref: "#/$defs/missing", $defs: {} }, "SCHEMA_REF_UNRESOLVED"],
    [{ type: [] }, "SCHEMA_TYPE"],
    [{ oneOf: Array.from({ length: 9 }, () => true) }, "SCHEMA_BRANCH_LIMIT"],
  ])("rejects unsupported profile input with %s", (schema, code) => {
    expect(() => admitSchema(schema)).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects a non-consuming local-ref cycle", () => {
    expect(() => admitSchema({ $ref: "#" })).toThrowError(
      expect.objectContaining({ code: "SCHEMA_NONCONSUMING_CYCLE" }),
    );
  });

  it("admits recursion that consumes an instance child", () => {
    const admitted = admitSchema({
      type: "object",
      properties: { next: { $ref: "#" } },
      additionalProperties: false,
    });
    expect(admitted.nodeCount).toBeGreaterThan(1);
  });

  it("rejects dangerous keys and excessive validation work", () => {
    const schema = JSON.parse('{"type":"object","properties":{"constructor":true}}');
    expect(() => admitSchema(schema)).toThrowError(
      expect.objectContaining({ code: "JSON_RESERVED_KEY" }),
    );
    const admitted = admitSchema({
      allOf: Array.from({ length: 8 }, () => ({ anyOf: [true, true] })),
    });
    let data: unknown = 1;
    for (let depth = 0; depth < 10; depth += 1) data = [data];
    expect(estimateValidationWork(admitted, data).supported).toBe(false);
  });

  it("emits only static admission errors", () => {
    try {
      admitSchema({ pattern: "SECRET" });
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaAdmissionError);
      expect(String(error)).not.toContain("SECRET");
    }
  });
});

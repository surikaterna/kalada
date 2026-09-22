import { ingestSchemaDocument, jsonSchemaProvider } from "@scheman/core";
import { describe, expect, it, vi } from "vitest";
import { admitSchema } from "./admission.js";
import { createWholeDataValidator } from "./validator.js";

const validCases: ReadonlyArray<readonly [unknown, unknown, boolean]> = [
  [{ type: "null" }, null, true],
  [{ type: "boolean" }, false, true],
  [{ type: "integer" }, 1.5, false],
  [{ type: "number", minimum: 1, exclusiveMaximum: 3 }, 2, true],
  [{ type: "string", minLength: 2, maxLength: 3 }, "a", false],
  [{ const: { x: 1 } }, { x: 1 }, true],
  [{ enum: ["a", "b"] }, "c", false],
  [{ type: "array", items: { type: "number" }, minItems: 1 }, [1], true],
  [{ prefixItems: [{ type: "string" }], items: false }, ["a", 1], false],
  [{ anyOf: [{ type: "string" }, { type: "number" }] }, 2, true],
  [{ oneOf: [{ type: "number" }, { minimum: 0 }] }, 2, false],
  [{ allOf: [{ type: "number" }, { minimum: 0 }] }, -1, false],
  [{ type: "object", required: ["x"], properties: { x: { type: "string" } } }, {}, false],
  [{ type: "object", properties: {}, additionalProperties: false }, { x: 1 }, false],
  [{ type: "number", multipleOf: 2 }, 3, false],
];

describe("whole-data validator bridge", () => {
  it.each(validCases)("conforms for schema %j and value %j", (schema, value, valid) => {
    expect(createWholeDataValidator(admitSchema(schema)).validate(value).valid).toBe(valid);
  });

  it("validates same-document refs and consuming recursion without fetching", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const bridge = createWholeDataValidator(
      admitSchema({
        $ref: "#/$defs/node",
        $defs: {
          node: {
            type: "object",
            properties: { value: { type: "string" }, next: { $ref: "#/$defs/node" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      }),
    );
    expect(bridge.validate({ value: "a", next: { value: "b" } }).valid).toBe(true);
    expect(bridge.validate({ value: 1 }).valid).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("provides a synchronous identity Standard Schema bridge with sanitized failure", () => {
    const bridge = createWholeDataValidator(admitSchema({ type: "string" }));
    expect(bridge.standard["~standard"].validate("ok")).toEqual({ value: "ok" });
    expect(bridge.standard["~standard"].validate(1)).toEqual({
      issues: [{ message: "Data failed schema validation" }],
    });
  });

  it("proves Scheman JSON ingestion supplies structure but no validator", () => {
    const result = ingestSchemaDocument(
      { type: "object", properties: { x: { type: "string" } } },
      { provider: jsonSchemaProvider({ dialect: "draft-2020-12" }) },
    );
    expect(Object.keys(result.document.nodes).length).toBeGreaterThan(0);
    expect(result.validator).toBeUndefined();
  });
});

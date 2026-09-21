import type { SchemaDocument, SchemaNode } from "@scheman/core";
import { describe, expect, it } from "vitest";
import { adaptSchemanDocument } from "./adapter.js";
import { SCHEMAN_MAPPING_FIXTURE_MATRIX, SCHEMAN_SEMANTIC_MAPPING } from "./mapping-table.js";
import { testDocument } from "./test-document.js";

const config = {
  mode: "sync" as const,
  providerId: "mapping.test",
  providerVersion: "1",
  configurationDigest: "sha256:mapping",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
};
const type = (name: string) => ({ kind: "primitive-type", name });

function projected(document: SchemaDocument) {
  const result = adaptSchemanDocument({ ...config, document });
  expect(result.ok).toBe(true);
  return result.ok ? result.environment.bindings[0]?.semanticType : undefined;
}

describe("closed semantic mapping", () => {
  it("exports the documented mapping table and fixture matrix", () => {
    expect(SCHEMAN_SEMANTIC_MAPPING).toHaveLength(12);
    expect(SCHEMAN_MAPPING_FIXTURE_MATRIX).toHaveLength(21);
    expect(new Set(SCHEMAN_MAPPING_FIXTURE_MATRIX.map(([name]) => name)).size).toBe(21);
  });

  it.each([
    ["null", "null"],
    ["boolean", "boolean"],
    ["string", "string"],
    ["number", "number"],
    ["integer", "number"],
  ] as const)("maps primitive %s conservatively", (source, expected) => {
    expect(projected(testDocument({ kind: "primitive", type: source }))).toEqual(type(expected));
  });

  it("maps only one-domain literals and enums", () => {
    expect(projected(testDocument({ kind: "literal", value: "x" }))).toEqual(type("string"));
    expect(projected(testDocument({ kind: "enum", values: [1, 2] }))).toEqual(type("number"));
    expect(projected(testDocument({ kind: "enum", values: [1, "x"] }))).toBe("dynamic");
  });

  it("requires concrete array items and equal union/intersection projections", () => {
    expect(
      projected(withTarget({ kind: "array", items: { nodeId: "target" } }, stringNode())),
    ).toEqual({
      kind: "array-type",
      element: type("string"),
    });
    expect(projected(withBranches("union", stringNode(), stringNode()))).toEqual(type("string"));
    expect(projected(withBranches("intersection", stringNode(), stringNode()))).toEqual(
      type("string"),
    );
    expect(
      projected(withBranches("union", stringNode(), { kind: "primitive", type: "number" })),
    ).toBe("dynamic");
  });

  it("maps proven JSON-safe structures and same-document refs", () => {
    const object: SchemaNode = {
      kind: "object",
      properties: [{ name: "name", presence: "required", node: { nodeId: "target" } }],
      required: ["name"],
      unknownKeys: "reject",
    };
    expect(projected(withTarget(object, stringNode()))).toEqual(type("json"));
    expect(
      projected(
        withTarget(
          { kind: "ref", reference: "#/$defs/value", target: { nodeId: "target" } },
          stringNode(),
        ),
      ),
    ).toEqual(type("string"));
    expect(
      projected(
        testDocument({ kind: "ref", reference: "https://example.test/x", unresolved: "external" }),
      ),
    ).toBe("dynamic");
  });

  it.each(["undefined", "void", "bigint", "symbol", "date", "NaN"] as const)(
    "keeps unsupported primitive %s dynamic",
    (source) => {
      expect(projected(testDocument({ kind: "primitive", type: source }))).toBe("dynamic");
    },
  );

  it.each(["optional", "nullable", "default", "catch", "pipeline", "effect", "coerce"] as const)(
    "does not infer through %s wrappers",
    (wrapper) => {
      const document = withTarget(
        { kind: "wrapper", wrapper, inner: { nodeId: "target" } },
        stringNode(),
      );
      expect(projected(document)).toBe("dynamic");
    },
  );

  it("passes through non-transforming wrappers but rejects applicator ambiguity", () => {
    const readonly = withTarget(
      { kind: "wrapper", wrapper: "readonly", inner: { nodeId: "target" } },
      stringNode(),
    );
    expect(projected(readonly)).toEqual(type("string"));
    expect(
      projected(
        withTarget(
          { kind: "primitive", type: "string", applicators: { not: { nodeId: "target" } } },
          stringNode(),
        ),
      ),
    ).toBe("dynamic");
  });
});

function stringNode(): SchemaNode {
  return { kind: "primitive", type: "string" };
}

function withTarget(root: SchemaNode, target: SchemaNode): SchemaDocument {
  return testDocument(root, root, { target });
}

function withBranches(kind: "union" | "intersection", left: SchemaNode, right: SchemaNode) {
  const refs = [{ nodeId: "left" }, { nodeId: "right" }];
  const root: SchemaNode =
    kind === "union" ? { kind, alternatives: refs, semantics: "anyOf" } : { kind, operands: refs };
  return testDocument(root, root, { left, right });
}

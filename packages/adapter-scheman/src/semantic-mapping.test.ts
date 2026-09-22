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

  it.each(SCHEMAN_MAPPING_FIXTURE_MATRIX)("executes exported fixture row %s", (name) => {
    matrixExecutors[name]();
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

type MatrixName = (typeof SCHEMAN_MAPPING_FIXTURE_MATRIX)[number][0];
const matrixExecutors: Record<MatrixName, () => void> = {
  "primitive-null": () =>
    expect(projected(testDocument({ kind: "primitive", type: "null" }))).toEqual(type("null")),
  "primitive-boolean": () =>
    expect(projected(testDocument({ kind: "primitive", type: "boolean" }))).toEqual(
      type("boolean"),
    ),
  "primitive-string": () =>
    expect(projected(testDocument({ kind: "primitive", type: "string" }))).toEqual(type("string")),
  "primitive-number": () =>
    expect(projected(testDocument({ kind: "primitive", type: "number" }))).toEqual(type("number")),
  "primitive-integer": () =>
    expect(projected(testDocument({ kind: "primitive", type: "integer" }))).toEqual(type("number")),
  "literal-primitive": () =>
    expect(projected(testDocument({ kind: "literal", value: "literal" }))).toEqual(type("string")),
  "enum-single-domain": () =>
    expect(projected(testDocument({ kind: "enum", values: [true, false] }))).toEqual(
      type("boolean"),
    ),
  "enum-mixed-domain": () =>
    expect(projected(testDocument({ kind: "enum", values: [true, "false"] }))).toBe("dynamic"),
  "array-concrete-item": () =>
    expect(
      projected(withTarget({ kind: "array", items: { nodeId: "target" } }, stringNode())),
    ).toEqual({
      kind: "array-type",
      element: type("string"),
    }),
  "array-dynamic-item": () =>
    expect(
      projected(
        withTarget(
          { kind: "array", items: { nodeId: "target" } },
          { kind: "unknown", reason: "partial" },
        ),
      ),
    ).toBe("dynamic"),
  "json-safe-object-record-tuple": () => assertJsonStructures(),
  "homogeneous-union-intersection": () => {
    expect(projected(withBranches("union", stringNode(), stringNode()))).toEqual(type("string"));
    expect(projected(withBranches("intersection", stringNode(), stringNode()))).toEqual(
      type("string"),
    );
  },
  "heterogeneous-union": () =>
    expect(
      projected(withBranches("union", stringNode(), { kind: "primitive", type: "number" })),
    ).toBe("dynamic"),
  "resolved-local-ref": () =>
    expect(
      projected(
        withTarget(
          { kind: "ref", reference: "#target", target: { nodeId: "target" } },
          stringNode(),
        ),
      ),
    ).toEqual(type("string")),
  "unresolved-or-external-ref": () =>
    expect(
      projected(
        withTarget(
          { kind: "ref", reference: "https://example.test", target: { nodeId: "target" } },
          stringNode(),
        ),
      ),
    ).toBe("dynamic"),
  "readonly-or-brand-wrapper": () => {
    for (const wrapper of ["readonly", "brand"] as const) {
      expect(
        projected(
          withTarget({ kind: "wrapper", wrapper, inner: { nodeId: "target" } }, stringNode()),
        ),
      ).toEqual(type("string"));
    }
  },
  "json-unconstrained": () =>
    expect(projected(testDocument({ kind: "unconstrained", domain: "json" }))).toEqual(
      type("json"),
    ),
  "unknown-opaque-never-js-unconstrained": () => {
    for (const node of unsupportedStructuralNodes())
      expect(projected(testDocument(node))).toBe("dynamic");
  },
  "undefined-void-bigint-symbol-date-nan": () => {
    for (const source of ["undefined", "void", "bigint", "symbol", "date", "NaN"] as const) {
      expect(projected(testDocument({ kind: "primitive", type: source }))).toBe("dynamic");
    }
  },
  "optional-nullable-default-catch-effect-pipeline-coerce": () => {
    for (const wrapper of [
      "optional",
      "nullable",
      "default",
      "catch",
      "effect",
      "pipeline",
      "coerce",
    ] as const) {
      expect(
        projected(
          withTarget({ kind: "wrapper", wrapper, inner: { nodeId: "target" } }, stringNode()),
        ),
      ).toBe("dynamic");
    }
  },
  "unsupported-applicator": () =>
    expect(
      projected(
        withTarget(
          { kind: "primitive", type: "string", applicators: { contains: { nodeId: "target" } } },
          stringNode(),
        ),
      ),
    ).toBe("dynamic"),
};

function assertJsonStructures(): void {
  const object: SchemaNode = {
    kind: "object",
    properties: [],
    required: [],
    unknownKeys: "reject",
  };
  expect(projected(testDocument(object))).toEqual(type("json"));
  const record: SchemaNode = {
    kind: "record",
    key: { nodeId: "key" },
    value: { nodeId: "value" },
    exhaustive: true,
  };
  expect(
    projected(testDocument(record, record, { key: stringNode(), value: stringNode() })),
  ).toEqual(type("json"));
  const tuple: SchemaNode = { kind: "tuple", items: [{ nodeId: "value" }] };
  expect(projected(testDocument(tuple, tuple, { value: stringNode() }))).toEqual(type("json"));
}

function unsupportedStructuralNodes(): SchemaNode[] {
  return [
    { kind: "unknown", reason: "partial" },
    { kind: "opaque", reason: "vendor" },
    { kind: "never" },
    { kind: "unconstrained", domain: "js" },
  ];
}

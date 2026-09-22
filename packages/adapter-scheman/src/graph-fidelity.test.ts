import type { SchemaDocument, SchemaNode } from "@scheman/core";
import { describe, expect, it } from "vitest";
import { adaptSchemanDocument } from "./adapter.js";

const root: SchemaNode = {
  kind: "object",
  properties: [
    { name: "maybe", presence: "unknown", node: { nodeId: "wrapper" } },
    { name: "choice", presence: "optional", node: { nodeId: "union" } },
  ],
  required: ["declared-without-shape"],
  additionalProperties: { nodeId: "record" },
  unknownKeys: "schema",
  constraints: { minProperties: 1 },
  applicators: {
    if: { nodeId: "literal" },
    patternProperties: { "^x": { nodeId: "enum" } },
  },
};

const nodes: Record<string, SchemaNode> = {
  root,
  wrapper: { kind: "wrapper", wrapper: "optional", inner: { nodeId: "ref" } },
  ref: { kind: "ref", reference: "#", target: { nodeId: "root" } },
  union: {
    kind: "union",
    alternatives: [{ nodeId: "literal" }, { nodeId: "enum" }],
    semantics: "oneOf",
    discriminator: { propertyName: "kind" },
  },
  literal: { kind: "literal", value: "x" },
  enum: { kind: "enum", values: ["x", "y"] },
  record: {
    kind: "record",
    key: { nodeId: "string" },
    value: { nodeId: "intersection" },
    exhaustive: "unknown",
  },
  intersection: {
    kind: "intersection",
    operands: [{ nodeId: "tuple" }, { nodeId: "array" }],
  },
  tuple: { kind: "tuple", items: [{ nodeId: "string" }], rest: { nodeId: "opaque" } },
  array: { kind: "array", items: { nodeId: "string" } },
  string: { kind: "primitive", type: "string" },
  opaque: { kind: "opaque", reason: "vendor-evidence" },
  never: { kind: "never" },
  unconstrained: { kind: "unconstrained", domain: "js" },
};

const document: SchemaDocument = {
  formatVersion: 1,
  root: { input: { nodeId: "root" }, output: { nodeId: "string" } },
  nodes,
  definitions: [
    { side: "input", sourcePointer: "/$defs/item", name: "item", node: { nodeId: "root" } },
  ],
  metadata: { provider: "fidelity" },
  capabilities: { input: "partial", output: "complete" },
  diagnostics: [
    {
      code: "VENDOR_EVIDENCE",
      severity: "warning",
      side: "input",
      sourcePointer: "/x",
      nodeId: "opaque",
    },
  ],
};

describe("recursive graph fidelity", () => {
  it("preserves schema-neutral node kinds, evidence, order, presence, and cycles", () => {
    const result = adaptSchemanDocument({
      document,
      mode: "sync",
      providerId: "fidelity.test",
      providerVersion: "1",
      configurationDigest: "sha256:fidelity",
      cacheable: true,
      binding: { id: "value", name: "value", path: ["value"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = result.environment.editorGraph;
    expect(graph.nodeIdScope).toBe("document-local");
    expect(graph.definitions.map((definition) => definition.name)).toEqual(Object.keys(nodes));
    const bySource = new Map(
      graph.nodes.filter((node) => node.sourceId).map((node) => [node.sourceId, node]),
    );
    expect(new Set([...bySource.values()].map((node) => node.kind))).toEqual(
      new Set([
        "object",
        "wrapper",
        "reference",
        "union",
        "literal",
        "enum",
        "record",
        "intersection",
        "tuple",
        "array",
        "scalar",
        "opaque",
        "never",
        "unconstrained",
      ]),
    );
    expect(bySource.get("root")).toMatchObject({
      kind: "object",
      requiredNames: ["declared-without-shape"],
      unknownKeys: "schema",
      constraints: { minProperties: 1 },
      properties: [
        { name: "maybe", presence: "unknown", required: false },
        { name: "choice", presence: "optional", required: false },
      ],
      relations: [{ name: "if" }, { name: "patternProperties", key: "^x" }],
    });
    expect(bySource.get("ref")).toMatchObject({
      kind: "reference",
      reference: "#",
      status: "resolved",
      target: { cycle: true },
    });
  });

  it("keeps Scheman definitions, capabilities, and diagnostics in sanitized provenance", () => {
    const result = adaptSchemanDocument({
      document,
      mode: "sync",
      providerId: "fidelity.test",
      providerVersion: "1",
      configurationDigest: "sha256:fidelity",
      cacheable: true,
      binding: { id: "value", name: "value", path: ["value"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: {
        definitions: [
          { side: "input", sourcePointer: "/$defs/item", name: "item", node: { nodeId: "root" } },
        ],
        capabilities: { input: "partial", output: "complete" },
      },
    });
    expect(result.diagnostics[0]).toEqual({
      code: "VENDOR_EVIDENCE",
      severity: "warning",
      side: "input",
      sourcePointer: "/x",
      nodeId: "opaque",
      provenance: { providerId: "@scheman/core", formatVersion: "1" },
    });
    expect(Object.isFrozen(result.environment)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
  });
});

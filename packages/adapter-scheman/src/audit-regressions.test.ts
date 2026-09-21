import type { EditorGraph } from "@kalada/host";
import {
  ingestSchemaDocument,
  jsonSchemaProvider,
  type OwnedValue,
  type SchemaDocument,
  type SchemaNode,
} from "@scheman/core";
import { describe, expect, it } from "vitest";
import { adaptSchemanDocument } from "./adapter.js";
import { DEFAULT_SCHEMAN_ANALYSIS_LIMITS } from "./analysis-limits.js";
import { schemanEditorDocument } from "./editor-document.js";
import { testDocument } from "./test-document.js";

const base = {
  mode: "sync" as const,
  providerId: "audit.test",
  providerVersion: "1",
  configurationDigest: "sha256:audit",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
};

describe("auditor adversarial regressions", () => {
  it("bounds a 20,000-wrapper projection without recursive stack failure", () => {
    const nodes: Record<string, SchemaNode> = {};
    for (let index = 19_999; index >= 0; index -= 1) {
      nodes[`w${index}`] =
        index === 19_999
          ? { kind: "primitive", type: "string" }
          : { kind: "wrapper", wrapper: "readonly", inner: { nodeId: `w${index + 1}` } };
    }
    const document = documentWithNodes("w0", nodes);
    expect(() => adaptSchemanDocument({ ...base, document })).not.toThrow();
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.semanticType).toBe("dynamic");
    expect(result.diagnostics.some((item) => item.code === "SCHEMAN_ADAPTER_ANALYSIS_LIMIT")).toBe(
      true,
    );
  });

  it("honors lower caller analysis limits deterministically", () => {
    const nodes: Record<string, SchemaNode> = {
      w0: { kind: "wrapper", wrapper: "readonly", inner: { nodeId: "w1" } },
      w1: { kind: "wrapper", wrapper: "readonly", inner: { nodeId: "w2" } },
      w2: { kind: "wrapper", wrapper: "readonly", inner: { nodeId: "value" } },
      value: { kind: "primitive", type: "string" },
    };
    const result = adaptSchemanDocument({
      ...base,
      document: documentWithNodes("w0", nodes),
      analysisLimits: { maxNodes: 3, maxEdges: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.semanticType).toBe("dynamic");
    expect(result.diagnostics.map((item) => item.code)).toContain("SCHEMAN_ADAPTER_ANALYSIS_LIMIT");
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: { bounded: { limits: { maxNodes: 3, maxEdges: 3 }, truncated: true } },
    });
  });

  it("retains roots and bounded evidence for a 2,049-node table", () => {
    const nodes: Record<string, SchemaNode> = { root: { kind: "primitive", type: "string" } };
    for (let index = 0; index < 2_048; index += 1) {
      nodes[`extra-${index}`] = { kind: "primitive", type: "string" };
    }
    const result = adaptSchemanDocument({ ...base, document: documentWithNodes("root", nodes) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.semanticType).toEqual({
      kind: "primitive-type",
      name: "string",
    });
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: { bounded: { retainedNodes: 2_048, truncated: true } },
    });
    expect(
      result.environment.editorGraph.nodes.some((node) =>
        node.evidence.some((evidence) => evidence.code === "node-limit"),
      ),
    ).toBe(true);
  });

  it("bounds exactly 8,193 property edges before host validation", () => {
    const properties = Array.from({ length: 8_193 }, (_, index) => ({
      name: `property-${index}`,
      presence: "optional" as const,
      node: { nodeId: "leaf" },
    }));
    const root: SchemaNode = {
      kind: "object",
      properties,
      required: [],
      unknownKeys: "reject",
    };
    const document = testDocument(root, root, { leaf: { kind: "primitive", type: "string" } });
    const editor = schemanEditorDocument(document, DEFAULT_SCHEMAN_ANALYSIS_LIMITS);
    const definition = editor.document.definitions?.find((item) => item.name === "input");
    expect(editor).toMatchObject({
      edgeTruncated: true,
      retainedEdges: 4_093,
      sourceEdges: { retained: 4_093, total: 8_193, truncated: true },
    });
    expect(definition?.shape.kind).toBe("object");
    if (definition?.shape.kind !== "object") return;
    expect(definition.shape.properties).toHaveLength(4_093);
    expect(definition.shape.properties[0]?.name).toBe("property-0");
    expect(definition.shape.properties[1]?.name).toBe("property-1");
    expect(definition.shape.properties.at(-1)?.name).toBe("property-4092");
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: { bounded: { edges: { retained: 4_093, total: 8_193, truncated: true } } },
    });
    expect(hasGraphEvidence(result.environment.editorGraph, "edge-limit")).toBe(true);
  });

  it.each([8_192, 8_193])(
    "normalizes a resolved deterministic prefix for %i optional real-provider properties",
    (count) => {
      const { document, names } = optionalPropertiesDocument(count);
      const result = adaptSchemanDocument({ ...base, document });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const graph = result.environment.editorGraph;
      const rootReference = graph.nodes.find((node) => node.id === graph.roots[0]?.nodeId);
      expect(rootReference).toMatchObject({ kind: "reference", status: "resolved" });
      const root = graph.nodes.find((node) => node.sourceId === document.root.input.nodeId);
      expect(root?.kind).toBe("object");
      if (root?.kind !== "object") return;
      expect(root.properties.length).toBeGreaterThan(1);
      expect(root.properties.length).toBeLessThan(count);
      expect(root.properties[0]).toMatchObject({
        name: names[0],
        presence: "optional",
        required: false,
      });
      expect(root.properties.at(-1)?.name).toBe(names[root.properties.length - 1]);
      expect(
        graph.nodes.every(
          (node) =>
            node.kind !== "reference" ||
            node.unresolved !== undefined ||
            (node.reference !== undefined && !node.reference.startsWith("#")) ||
            node.status === "resolved",
        ),
      ).toBe(true);
      expect(graph.admission?.total).toBeLessThanOrEqual(graph.limits.maxEdges);
      expect(claimedGraphEdges(graph)).toBe(graph.admission?.total);
      expect(result.environment.bindings[0]?.metadata).toMatchObject({
        scheman: {
          bounded: {
            sourceRetention: {
              edges: {
                retained: root.properties.length,
                total: expect.any(Number),
                truncated: true,
              },
            },
          },
        },
      });
      expect(hasGraphEvidence(graph, "edge-limit")).toBe(true);
    },
  );

  it("reports a deterministic required-name prefix from the real JSON provider", () => {
    const { document, names } = requiredNamesDocument(8_193);
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.environment.editorGraph.nodes.find(
      (node) => node.sourceId === document.root.input.nodeId,
    );
    expect(root?.kind).toBe("object");
    if (root?.kind !== "object") return;
    expect(root.requiredNames).toHaveLength(8_192);
    expect(root.requiredNames?.[0]).toBe(names[0]);
    expect(root.requiredNames?.at(-1)).toBe(names[8_191]);
    expect(root.properties).toMatchObject([
      { name: names[0], presence: "required", required: true },
      { name: names[8_192], presence: "required", required: true },
    ]);
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: {
        bounded: {
          requiredNames: { retained: 8_192, total: 16_386, truncated: true },
          truncated: true,
        },
      },
    });
    expect(hasGraphEvidence(result.environment.editorGraph, "edge-limit")).toBe(true);
    const diagnostic = result.diagnostics.find(
      (item) =>
        item.code === "SCHEMAN_ADAPTER_ANALYSIS_LIMIT" &&
        item.sourcePointer === "/nodes/*/required",
    );
    expect(diagnostic).toBeDefined();
    expect(Object.isFrozen(diagnostic)).toBe(true);
  });

  it("retains the exact required-name bound without limit evidence", () => {
    const { document } = requiredNamesDocument(8_192);
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.environment.editorGraph.nodes.find(
      (node) => node.sourceId === document.root.input.nodeId,
    );
    expect(root).toMatchObject({ kind: "object", requiredNames: { length: 8_192 } });
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: {
        bounded: { requiredNames: { retained: 16_384, total: 16_384, truncated: false } },
      },
    });
    expect(hasGraphEvidence(result.environment.editorGraph, "edge-limit")).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "SCHEMAN_ADAPTER_ANALYSIS_LIMIT")).toBe(
      false,
    );
  });

  it("reserves host structure for combined property and required-name overflow", () => {
    const { document, names } = combinedLimitDocument();
    const input = document.nodes[document.root.input.nodeId];
    expect(input?.kind).toBe("object");
    if (input?.kind !== "object") return;
    expect(input.properties).toHaveLength(8_192);
    expect(new Set(input.properties.map((property) => property.node.nodeId)).size).toBe(1);

    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = result.environment.editorGraph;
    const expectedRetainedEdges = 4_091;
    const expectedProperties = expectedRetainedEdges;
    const expectedRequiredNames = Object.values(document.nodes).reduce(
      (total, node) => total + (node.kind === "object" ? node.required.length : 0),
      0,
    );
    const rootReference = graph.nodes.find((node) => node.id === graph.roots[0]?.nodeId);
    expect(rootReference).toMatchObject({ kind: "reference", status: "resolved" });
    const root = graph.nodes.find((node) => node.sourceId === document.root.input.nodeId);
    expect(root?.kind).toBe("object");
    if (root?.kind !== "object") return;
    expect(root.sourceId).toBe(document.root.input.nodeId);
    expect(root.properties).toHaveLength(expectedProperties);
    expect(root.properties[0]).toMatchObject({
      name: names[0],
      presence: "required",
      required: true,
    });
    expect(root.properties.at(-1)).toMatchObject({
      name: names[expectedProperties - 1],
      presence: "required",
      required: true,
    });
    expect(root.requiredNames).toHaveLength(8_192);
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: {
        bounded: {
          edges: { retained: expectedRetainedEdges, total: 8_193, truncated: true },
          requiredNames: { retained: 8_192, total: expectedRequiredNames, truncated: true },
          truncated: true,
        },
      },
    });
    expect(hasGraphEvidence(graph, "edge-limit")).toBe(true);
    expect(
      result.diagnostics.some(
        (item) =>
          item.code === "SCHEMAN_ADAPTER_ANALYSIS_LIMIT" &&
          item.sourcePointer === "/nodes/*/required",
      ),
    ).toBe(true);
    expect(claimedGraphEdges(graph)).toBeLessThanOrEqual(graph.limits.maxEdges);
    expect(claimedGraphEdges(graph)).toBe(graph.admission?.total);
    expect(graph.nodes.length).toBeLessThanOrEqual(graph.limits.maxNodes);
  });

  it("reports bounded definition provenance independently from node selection", () => {
    const source = documentWithNodes("root", { root: { kind: "primitive", type: "string" } });
    const document: SchemaDocument = {
      ...source,
      definitions: Array.from({ length: 3_000 }, (_, index) => ({
        side: "input" as const,
        sourcePointer: `/$defs/${index}`,
        name: `definition-${index}`,
        node: { nodeId: "root" },
      })),
      diagnostics: Array.from({ length: 3_000 }, (_, index) => ({
        code: `SOURCE_${index}`,
        severity: "warning" as const,
        side: "input" as const,
        sourcePointer: `/diagnostics/${index}`,
      })),
    };
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: {
        bounded: {
          nodes: { retained: 1, total: 1, truncated: false },
          definitions: { retained: 512, total: 3_000, truncated: true },
          diagnostics: { retained: 512, total: 3_000, truncated: true },
        },
      },
    });
    expect(result.diagnostics).toHaveLength(513);
    expect(result.diagnostics.at(-1)?.code).toBe("SCHEMAN_ADAPTER_ANALYSIS_LIMIT");
    expect(Object.isFrozen(result.diagnostics.at(-1))).toBe(true);
  });

  it("refuses an external reference target spoof in semantics and editor links", () => {
    const root: SchemaNode = {
      kind: "ref",
      reference: "https://evil.test/schema",
      target: { nodeId: "target" },
    };
    const result = adaptSchemanDocument({
      ...base,
      document: testDocument(root, root, { target: { kind: "primitive", type: "string" } }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.semanticType).toBe("dynamic");
    const ref = result.environment.editorGraph.nodes.find((node) => node.sourceId === "input");
    expect(ref).toMatchObject({
      kind: "reference",
      status: "unresolved",
      reference: "https://evil.test/schema",
    });
  });

  it.each(["dynamic-reference-unsupported", "resource-rebase-unsupported", "unresolved-reference"])(
    "refuses a local-looking target carrying %s evidence",
    (unresolved) => {
      const root: SchemaNode = {
        kind: "ref",
        reference: "#local",
        target: { nodeId: "target" },
        unresolved,
      };
      const result = adaptSchemanDocument({
        ...base,
        document: testDocument(root, root, { target: { kind: "primitive", type: "string" } }),
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.environment.bindings[0]?.semanticType).toBe("dynamic");
    },
  );

  it.each(["passthrough", "unknown"] as const)(
    "requires additional-property proof for unknownKeys=%s",
    (unknownKeys) => {
      expect(projectObject(unknownKeys)).toBe("dynamic");
      expect(projectObject(unknownKeys, { nodeId: "additional" })).toEqual({
        kind: "primitive-type",
        name: "json",
      });
      expect(
        projectObject(unknownKeys, { nodeId: "additional" }, { kind: "primitive", type: "bigint" }),
      ).toBe("dynamic");
    },
  );

  it.each(["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const)(
    "sanitizes a profile proxy throwing from %s",
    (trap) => {
      const profile = hostileProxy(trap);
      const result = adaptSchemanDocument({ ...base, document: profiledDocument(profile) });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("SCHEMAN_ADAPTER_PROFILE_MALFORMED");
      expect(JSON.stringify(result)).not.toContain("auditor-secret");
    },
  );

  it("never executes profile getters", () => {
    let calls = 0;
    const profile = Object.defineProperty({}, "type", {
      enumerable: true,
      get() {
        calls += 1;
        return { kind: "primitive-type", name: "string" };
      },
    });
    Object.defineProperty(profile, "version", { enumerable: true, value: 1 });
    const result = adaptSchemanDocument({
      ...base,
      document: profiledDocument(profile as OwnedValue),
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("rejects symbol-bearing profile records without inspecting symbol values", () => {
    let calls = 0;
    const symbol = Symbol("profile");
    const profile = { version: 1, type: { kind: "primitive-type", name: "string" } } as Record<
      PropertyKey,
      unknown
    >;
    Object.defineProperty(profile, symbol, {
      get() {
        calls += 1;
        return "auditor-secret";
      },
    });
    const result = adaptSchemanDocument({
      ...base,
      document: profiledDocument(profile as OwnedValue),
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("SCHEMAN_ADAPTER_PROFILE_MALFORMED");
    expect(calls).toBe(0);
  });

  it("distinguishes own-present undefined profiles at every location", () => {
    expect(profileCode({ "x-kalada": undefined } as never)).toBe(
      "SCHEMAN_ADAPTER_PROFILE_MALFORMED",
    );
    expect(profileCode({ extensions: { "x-kalada": undefined } } as never)).toBe(
      "SCHEMAN_ADAPTER_PROFILE_MALFORMED",
    );
    expect(profileCode({ annotations: { "x-kalada": undefined } } as never)).toBe(
      "SCHEMAN_ADAPTER_PROFILE_CONFLICT",
    );
    expect(
      profileCode({
        "x-kalada": undefined,
        extensions: {
          "x-kalada": { version: 1, type: { kind: "primitive-type", name: "string" } },
        },
      } as never),
    ).toBe("SCHEMAN_ADAPTER_PROFILE_CONFLICT");
  });

  it.each([null, "metadata", 42, true, ["annotation"]] as const)(
    "treats profile-free OwnedValue %j containers as valid",
    (value) => {
      for (const node of [
        { kind: "primitive", type: "string", metadata: value },
        { kind: "primitive", type: "string", constraints: value },
        { kind: "primitive", type: "string", metadata: { annotations: value } },
        { kind: "primitive", type: "string", metadata: { extensions: value } },
      ] as const) {
        const result = adaptSchemanDocument({
          ...base,
          document: testDocument(node as SchemaNode),
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.environment.bindings[0]?.semanticType).toEqual({
            kind: "primitive-type",
            name: "string",
          });
        }
      }
    },
  );
});

function documentWithNodes(rootId: string, nodes: Record<string, SchemaNode>): SchemaDocument {
  return {
    formatVersion: 1,
    root: { input: { nodeId: rootId }, output: { nodeId: rootId } },
    nodes,
    definitions: [],
    metadata: { provider: "audit" },
    capabilities: { input: "complete", output: "complete" },
    diagnostics: [],
  };
}

function projectObject(
  unknownKeys: "passthrough" | "unknown",
  additionalProperties?: { nodeId: string },
  additionalNode: SchemaNode = { kind: "unconstrained", domain: "json" },
) {
  const root: SchemaNode = {
    kind: "object",
    properties: [],
    required: [],
    unknownKeys,
    ...(additionalProperties ? { additionalProperties } : {}),
  };
  const extras: Record<string, SchemaNode> = additionalProperties
    ? { additional: additionalNode }
    : {};
  const result = adaptSchemanDocument({ ...base, document: testDocument(root, root, extras) });
  return result.ok ? result.environment.bindings[0]?.semanticType : undefined;
}

function hostileProxy(trap: "getPrototypeOf" | "ownKeys" | "getOwnPropertyDescriptor"): OwnedValue {
  const handler: ProxyHandler<object> = {
    [trap]() {
      throw new Error("auditor-secret");
    },
  };
  return new Proxy({}, handler) as OwnedValue;
}

function profiledDocument(profile: OwnedValue): SchemaDocument {
  return testDocument({ kind: "primitive", type: "string", metadata: { "x-kalada": profile } });
}

function profileCode(metadata: OwnedValue) {
  const document = testDocument({ kind: "primitive", type: "string", metadata });
  return adaptSchemanDocument({ ...base, document }).diagnostics[0]?.code;
}

function requiredNamesDocument(count: number) {
  const names = Array.from({ length: count }, (_, index) => `required-${index}`);
  const first = names[0] as string;
  const last = names.at(-1) as string;
  const { document } = ingestSchemaDocument(
    {
      type: "object",
      properties: { [first]: { type: "string" }, [last]: { type: "string" } },
      required: names,
      additionalProperties: false,
    },
    { provider: jsonSchemaProvider() },
  );
  return { document, names };
}

function combinedLimitDocument() {
  const names = Array.from({ length: 8_193 }, (_, index) => `combined-${index}`);
  const shared = { type: "string" } as const;
  const properties = Object.fromEntries(names.slice(0, 8_192).map((name) => [name, shared]));
  const { document } = ingestSchemaDocument(
    { type: "object", properties, required: names, additionalProperties: false },
    { provider: jsonSchemaProvider() },
  );
  return { document, names };
}

function optionalPropertiesDocument(count: number) {
  const names = Array.from({ length: count }, (_, index) => `optional-${index}`);
  const shared = { type: "string" } as const;
  const properties = Object.fromEntries(names.map((name) => [name, shared]));
  const { document } = ingestSchemaDocument(
    { type: "object", properties, additionalProperties: false },
    { provider: jsonSchemaProvider() },
  );
  return { document, names };
}

function claimedGraphEdges(graph: EditorGraph): number {
  return (
    graph.roots.length +
    graph.definitions.length +
    graph.nodes.reduce((total, node) => total + nodeClaimedEdges(node), 0)
  );
}

function hasGraphEvidence(graph: EditorGraph, code: "edge-limit" | "node-limit"): boolean {
  return (
    graph.evidence.some((item) => item.code === code) ||
    graph.nodes.some((node) => node.evidence.some((item) => item.code === code))
  );
}

function nodeClaimedEdges(node: EditorGraph["nodes"][number]): number {
  const relations = node.relations?.length ?? 0;
  if (node.kind === "object") {
    return relations + node.properties.length + (node.additionalProperties ? 1 : 0);
  }
  if (node.kind === "array") return relations + 1;
  if (node.kind === "tuple") return relations + node.items.length + (node.rest ? 1 : 0);
  if (node.kind === "union") return relations + node.variants.length;
  if (node.kind === "intersection") return relations + node.operands.length;
  if (node.kind === "record") return relations + 2;
  if (node.kind === "wrapper") return relations + 1;
  if (node.kind === "reference" && node.target) return relations + 1;
  return relations;
}

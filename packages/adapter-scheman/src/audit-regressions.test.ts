import type { OwnedValue, SchemaDocument, SchemaNode } from "@scheman/core";
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
    expect(editor).toMatchObject({ edgeTruncated: true, retainedEdges: 8_192 });
    expect(definition?.shape.kind).toBe("object");
    if (definition?.shape.kind !== "object") return;
    expect(definition.shape.properties).toHaveLength(8_192);
    expect(definition.shape.properties[0]?.name).toBe("property-0");
    expect(definition.shape.properties[1]?.name).toBe("property-1");
    expect(definition.shape.properties.at(-1)?.shape).toMatchObject({
      kind: "unknown",
      evidenceCode: "edge-limit",
    });
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: { bounded: { edges: { retained: 8_192, truncated: true } } },
    });
    expect(
      result.environment.editorGraph.nodes.some((node) =>
        node.evidence.some((evidence) => evidence.code === "edge-limit"),
      ),
    ).toBe(true);
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

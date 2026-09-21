import {
  ingestSchemaDocument,
  jsonSchemaProvider,
  type SchemaDocumentProvider,
  type StandardSchemaV1,
} from "@scheman/core";
import { describe, expect, it } from "vitest";
import { adaptSchemanDocument } from "./adapter.js";
import { DENY_SCHEMAN_EXECUTION_PERMISSIONS } from "./index.js";
import { testDocument } from "./test-document.js";

const binding = { id: "value", name: "value", path: ["value"] } as const;
const identity = {
  mode: "sync" as const,
  providerId: "test.scheman",
  providerVersion: "1",
  configurationDigest: "sha256:test",
  cacheable: true,
};

describe("Scheman v2 adapter", () => {
  it("keeps the input graph separate from the output projection", () => {
    const provider: SchemaDocumentProvider = {
      name: "dual-root",
      build(_schema, context) {
        const input = context.node("input", "/input", () => ({
          kind: "primitive",
          type: "string",
        }));
        const output = context.node("output", "/output", () => ({
          kind: "primitive",
          type: "integer",
        }));
        return { input, output };
      },
    };
    const { document } = ingestSchemaDocument({}, { provider });
    const result = adaptSchemanDocument({ ...identity, document, binding });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.semanticType).toEqual({
      kind: "primitive-type",
      name: "number",
    });
    const sourceNode = result.environment.editorGraph.nodes.find(
      (node) => node.sourceId === document.root.input.nodeId,
    );
    expect(sourceNode).toMatchObject({ kind: "scalar", name: "string" });
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      scheman: {
        roots: { input: document.root.input.nodeId, output: document.root.output.nodeId },
      },
    });
  });

  it("preserves recursive JSON evidence and unsupported #35 features without fetching", () => {
    let fetched = false;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetched = true;
      throw new Error("fetch forbidden");
    }) as typeof fetch;
    try {
      const { document } = ingestSchemaDocument(
        {
          $id: "https://example.test/root",
          $defs: { anchored: { $anchor: "item", type: "string" } },
          type: "object",
          properties: {
            next: { $ref: "#" },
            anchored: { $ref: "#item" },
            dynamic: { $dynamicRef: "#node" },
            remote: { $ref: "https://example.test/remote" },
            nested: { $id: "nested", type: "string" },
          },
          unevaluatedProperties: false,
          $dynamicAnchor: "node",
        },
        { provider: jsonSchemaProvider() },
      );
      const result = adaptSchemanDocument({ ...identity, document, binding });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(fetched).toBe(false);
      expect(result.environment.editorGraph.nodes.some((node) => node.kind === "reference")).toBe(
        true,
      );
      expect(result.environment.editorGraph.nodes.some((node) => node.sourceId)).toBe(true);
      expect(
        result.diagnostics.some((item) => item.code === "JSON_RESOURCE_REBASE_UNSUPPORTED"),
      ).toBe(true);
      expect(result.diagnostics.some((item) => item.code === "JSON_UNSUPPORTED_KEYWORD")).toBe(
        true,
      );
      expect(result.diagnostics.some((item) => item.code === "JSON_UNRESOLVED_REFERENCE")).toBe(
        true,
      );
      const refs = result.environment.editorGraph.nodes.filter((node) => node.kind === "reference");
      expect(refs.some((node) => node.reference === "#item" && node.status === "resolved")).toBe(true);
      expect(refs.some((node) => node.reference?.startsWith("https://") && node.status === "unresolved")).toBe(
        true,
      );
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  it("retains a live validator outside normalized data without invoking it", () => {
    let calls = 0;
    const validator: StandardSchemaV1 = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate(value) {
          calls += 1;
          return { value };
        },
      },
    };
    const result = adaptSchemanDocument({
      ...identity,
      document: testDocument({ kind: "primitive", type: "string" }),
      binding,
      validator: {
        validator,
        mode: "sync",
        capabilityId: "test-validator",
        capabilityVersion: "1",
        configurationDigest: "sha256:validator",
        cacheable: true,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(0);
    expect(result.retainedValidator).toBe(validator);
    expect(Object.isFrozen(validator)).toBe(false);
    expect(result.environment.capabilities[0]).toMatchObject({ kind: "validator", mode: "sync" });
    expect(result.capabilitySnapshot.capabilities["scheman-validator"]?.kind).toBe("validator");
    expect(JSON.stringify(result.environment)).not.toContain("~standard");
  });

  it("rejects a format-version mismatch deterministically", () => {
    const document = { ...testDocument({ kind: "primitive", type: "string" }), formatVersion: 2 };
    const result = adaptSchemanDocument({ ...identity, document: document as never, binding });
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "SCHEMAN_ADAPTER_FORMAT_VERSION",
          severity: "error",
          side: "output",
          sourcePointer: "",
        },
      ],
    });
  });

  it("documents deny-by-default trusted Scheman execution permissions", () => {
    expect(DENY_SCHEMAN_EXECUTION_PERMISSIONS).toEqual({
      zod: { shape: false, lazy: false, metadata: false },
      standardJson: false,
    });
    expect(Object.isFrozen(DENY_SCHEMAN_EXECUTION_PERMISSIONS.zod)).toBe(true);
  });
});

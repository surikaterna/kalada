import type { OwnedValue, SchemaDocument, SchemaNode } from "@scheman/core";
import { describe, expect, it } from "vitest";
import { adaptSchemanDocument } from "./adapter.js";
import { metadataProfile, testDocument } from "./test-document.js";

const numberType = { kind: "primitive-type", name: "number" } as const;
const jsonType = { kind: "primitive-type", name: "json" } as const;
const stringType = { kind: "primitive-type", name: "string" } as const;
const base = {
  mode: "sync" as const,
  providerId: "profile.test",
  providerVersion: "1",
  configurationDigest: "sha256:profile",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
};

describe("x-kalada profile", () => {
  it("reads the exact node-local JSON extension", () => {
    const node: SchemaNode = {
      kind: "primitive",
      type: "string",
      metadata: { extensions: { "x-kalada": { version: 1, type: stringType } } },
    };
    const result = adaptSchemanDocument({ ...base, document: testDocument(node) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings[0]?.semanticType).toEqual(stringType);
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      policy: { source: "x-kalada", finalValidation: "kalada-type" },
    });
  });

  it("requires exact own-data keys and rejects duplicates or misplaced profiles", () => {
    const malformed = profiled({ version: 1, type: stringType, extra: true });
    expect(code(testDocument(malformed))).toBe("SCHEMAN_ADAPTER_PROFILE_MALFORMED");
    const duplicate: SchemaNode = {
      kind: "primitive",
      type: "string",
      metadata: {
        "x-kalada": { version: 1, type: stringType },
        extensions: { "x-kalada": { version: 1, type: stringType } },
      },
    };
    expect(code(testDocument(duplicate))).toBe("SCHEMAN_ADAPTER_PROFILE_CONFLICT");
    const misplaced: SchemaNode = {
      kind: "primitive",
      type: "string",
      metadata: { annotations: { "x-kalada": { version: 1, type: stringType } } },
    };
    expect(code(testDocument(misplaced))).toBe("SCHEMAN_ADAPTER_PROFILE_CONFLICT");
  });

  it("keeps codec IDs descriptive and demands matching executable permission", () => {
    const node = profiled({
      version: 1,
      type: numberType,
      codec: "bigint-number",
      lossy: "safe-integer-bigint-to-number",
    });
    expect(code(testDocument(node))).toBe("SCHEMAN_ADAPTER_CODEC_MISMATCH");
    let calls = 0;
    const result = adaptSchemanDocument({
      ...base,
      document: testDocument(node),
      codec: {
        id: "bigint-number",
        mode: "sync",
        capabilityVersion: "1",
        configurationDigest: "sha256:codec",
        cacheable: true,
        convert(value) {
          calls += 1;
          return Number(value);
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(0);
    expect(result.environment.bindings[0]?.codec).toMatchObject({
      capabilityId: "bigint-number",
      mode: "sync",
    });
    expect(result.environment.bindings[0]?.metadata).toMatchObject({
      policy: { finalValidation: "safe-integer-and-kalada-type" },
    });
  });

  it("enforces both named lossy policies", () => {
    const heterogeneous = unionNode();
    const profile = metadataProfile({
      version: 1,
      type: jsonType,
      codec: "union-json",
      lossy: "heterogeneous-union-to-json",
    });
    const document = testDocument({ ...heterogeneous, metadata: profile }, heterogeneous, {
      text: { kind: "primitive", type: "string" },
      count: { kind: "primitive", type: "number" },
    });
    const result = adaptSchemanDocument({
      ...base,
      document,
      codec: codec("union-json"),
    });
    expect(result.ok).toBe(true);
    expect(
      code(
        testDocument(
          profiled({
            version: 1,
            type: jsonType,
            codec: "wrong",
            lossy: "heterogeneous-union-to-json",
          }),
        ),
      ),
    ).toBe("SCHEMAN_ADAPTER_PROFILE_INCOMPATIBLE");
  });

  it("applies the explicit binding override first but still rejects malformed metadata", () => {
    const document = testDocument(profiled({ version: 1, type: stringType }));
    const result = adaptSchemanDocument({
      ...base,
      document,
      binding: { ...base.binding, override: { type: numberType, codec: "override-codec" } },
      codec: codec("override-codec"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.environment.bindings[0]?.semanticType).toEqual(numberType);
    const malformed = testDocument(profiled({ version: 2, type: stringType }));
    const rejected = adaptSchemanDocument({
      ...base,
      document: malformed,
      binding: { ...base.binding, override: { type: stringType } },
    });
    expect(rejected.ok).toBe(false);
  });

  it("does not inherit a child profile or infer ADTs from wrappers", () => {
    const child: SchemaNode = {
      kind: "primitive",
      type: "string",
      metadata: metadataProfile({ version: 1, type: stringType }),
    };
    const document = testDocument(
      { kind: "wrapper", wrapper: "optional", inner: { nodeId: "child" } },
      undefined,
      { child },
    );
    const result = adaptSchemanDocument({ ...base, document });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.environment.bindings[0]?.semanticType).toBe("dynamic");
  });
});

function profiled(profile: OwnedValue): SchemaNode {
  return { kind: "primitive", type: "bigint", metadata: metadataProfile(profile) };
}

function codec(id: string) {
  return {
    id,
    mode: "sync" as const,
    capabilityVersion: "1",
    configurationDigest: "sha256:codec",
    cacheable: true,
    convert: (value: unknown) => value,
  };
}

function code(document: SchemaDocument) {
  const result = adaptSchemanDocument({ ...base, document });
  return result.diagnostics[0]?.code;
}

function unionNode(): SchemaNode {
  return {
    kind: "union",
    alternatives: [{ nodeId: "text" }, { nodeId: "count" }],
    semantics: "oneOf",
  };
}

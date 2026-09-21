import { runInNewContext } from "node:vm";
import { compileExpression, linkExpression, parseExpression } from "@kalada/host";
import type { SchemaNode, StandardSchemaResult, StandardSchemaV1 } from "@scheman/core";
import { describe, expect, it } from "vitest";
import { adaptSchemanDocument } from "./adapter.js";
import { metadataProfile, testDocument } from "./test-document.js";
import type { AdaptSchemanResult, SchemanCodecOptions } from "./types.js";

const numberType = { kind: "primitive-type", name: "number" } as const;
const jsonType = { kind: "primitive-type", name: "json" } as const;
const base = {
  mode: "sync" as const,
  providerId: "execution.test",
  providerVersion: "1",
  configurationDigest: "sha256:execution",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
};

describe("Scheman prepared execution integration", () => {
  it("decodes a synchronous Standard Schema success with its receiver and types intact", () => {
    let receiver: unknown;
    const standard: StandardSchemaV1.Props<string, number> = {
      version: 1,
      vendor: "typed",
      validate(value) {
        receiver = this;
        return { value: Number(value) };
      },
    };
    const validator: StandardSchemaV1<string, number> = { "~standard": standard };
    const result = adaptWithValidator(validator);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const retained: StandardSchemaV1<string, number> | undefined = result.retainedValidator;
    expect(retained).toBe(validator);

    expect(linked(result, "value + 1").evaluate({ value: "2" })).toEqual({ ok: true, value: 3 });
    expect(receiver).toBe(standard);
  });

  it("maps Standard Schema issues to a sanitized decode failure before core", () => {
    const validator: StandardSchemaV1 = {
      "~standard": {
        version: 1,
        vendor: "issues",
        validate: () => ({ issues: [{ message: "SECRET ISSUE" }] }),
      },
    };
    const outcome = linked(adaptWithValidator(validator), "value / 0").evaluate({ value: 1 });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_BINDING_DECODE", phase: "bind" }],
    });
    expect(JSON.stringify(outcome)).not.toMatch(/SECRET ISSUE|KALADA_DIVISION_BY_ZERO/u);
  });

  it("returns a native Promise untouched for the host sync guard", () => {
    const pending = Promise.resolve({ value: 1 });
    expectThenableDecodeFailure(pending, 0);
  });

  it("returns a cross-realm Promise untouched for the host sync guard", () => {
    const pending = runInNewContext("Promise.resolve({ value: 1 })") as Promise<
      StandardSchemaResult<number>
    >;
    expectThenableDecodeFailure(pending, 0);
  });

  it("does not call a hostile then getter before the host rejects it", () => {
    let thenReads = 0;
    const pending = {};
    // biome-ignore lint/suspicious/noThenProperty: This fixture verifies hostile thenable rejection.
    Object.defineProperty(pending, "then", {
      get() {
        thenReads += 1;
        throw new Error("hostile then");
      },
    });
    expectThenableDecodeFailure(pending, thenReads);
    expect(thenReads).toBe(0);
  });

  it.each([
    ["maximum safe", 9_007_199_254_740_991n, true, Number.MAX_SAFE_INTEGER],
    ["minimum safe", -9_007_199_254_740_991n, true, Number.MIN_SAFE_INTEGER],
    ["above maximum", 9_007_199_254_740_992n, false, undefined],
    ["below minimum", -9_007_199_254_740_992n, false, undefined],
    ["rounded unsafe", 9_007_199_254_740_993n, false, undefined],
  ] as const)(
    "enforces safe bigint conversion at the %s boundary",
    (_name, input, ok, expected) => {
      const result = adaptSafeIntegerCodec((value) => Number(value));
      const outcome = linked(result, ok ? "value" : "value / 0").evaluate({ value: input });
      if (ok) {
        expect(outcome).toEqual({ ok: true, value: expected });
        return;
      }
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [{ code: "HOST_BINDING_CONVERSION", phase: "bind" }],
      });
    },
  );

  it("leaves codec thenables untouched for the host conversion guard", () => {
    let thenReads = 0;
    const pending = {};
    // biome-ignore lint/suspicious/noThenProperty: This fixture verifies hostile thenable rejection.
    Object.defineProperty(pending, "then", {
      get() {
        thenReads += 1;
        throw new Error("hostile codec then");
      },
    });
    const result = adaptSafeIntegerCodec(() => pending);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const capability = result.capabilitySnapshot.capabilities["scheman-codec"];
    expect(capability?.kind).toBe("codec");
    if (capability?.kind !== "codec") return;
    expect(capability.convert(1n)).toBe(pending);
    expect(linked(result, "value / 0").evaluate({ value: 1n })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_BINDING_CONVERSION", phase: "bind" }],
    });
    expect(thenReads).toBe(0);
  });

  it("retains final host JSON validation for heterogeneous-union conversion", () => {
    const accepted = adaptUnionCodec((value) => ({ value }));
    expect(linked(accepted, "value").evaluate({ value: "text" })).toEqual({
      ok: true,
      value: { value: "text" },
    });
    const rejected = adaptUnionCodec(() => undefined);
    expect(linked(rejected, "value.field").evaluate({ value: "text" })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_BINDING_SEMANTIC", phase: "bind" }],
    });
  });
});

function adaptWithValidator<Input, Output>(validator: StandardSchemaV1<Input, Output>) {
  return adaptSchemanDocument({
    ...base,
    document: testDocument({ kind: "primitive", type: "integer" }),
    validator: {
      validator,
      mode: "sync",
      capabilityId: "standard-validator",
      capabilityVersion: "1",
      configurationDigest: "sha256:validator",
      cacheable: true,
    },
  });
}

function expectThenableDecodeFailure(output: unknown, thenReads: number): void {
  const validator: StandardSchemaV1 = {
    "~standard": {
      version: 1,
      vendor: "thenable",
      validate: () => output as Promise<StandardSchemaResult<unknown>>,
    },
  };
  const result = adaptWithValidator(validator);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const capability = result.capabilitySnapshot.capabilities["scheman-validator"];
  expect(capability?.kind).toBe("validator");
  if (capability?.kind !== "validator") return;
  expect(capability.decode(1)).toBe(output);
  expect(linked(result, "value / 0").evaluate({ value: 1 })).toMatchObject({
    ok: false,
    diagnostics: [{ code: "HOST_BINDING_DECODE", phase: "bind" }],
  });
  expect(thenReads).toBe(0);
}

function adaptSafeIntegerCodec(convert: SchemanCodecOptions["convert"]) {
  const output: SchemaNode = {
    kind: "primitive",
    type: "bigint",
    metadata: metadataProfile({
      version: 1,
      type: numberType,
      codec: "bigint-number",
      lossy: "safe-integer-bigint-to-number",
    }),
  };
  return adaptSchemanDocument({
    ...base,
    document: testDocument(output),
    codec: codec("bigint-number", convert),
  });
}

function adaptUnionCodec(convert: SchemanCodecOptions["convert"]) {
  const input: SchemaNode = {
    kind: "union",
    alternatives: [{ nodeId: "text" }, { nodeId: "count" }],
    semantics: "oneOf",
  };
  const output: SchemaNode = {
    ...input,
    metadata: metadataProfile({
      version: 1,
      type: jsonType,
      codec: "union-json",
      lossy: "heterogeneous-union-to-json",
    }),
  };
  return adaptSchemanDocument({
    ...base,
    document: testDocument(output, input, {
      text: { kind: "primitive", type: "string" },
      count: { kind: "primitive", type: "number" },
    }),
    codec: codec("union-json", convert),
  });
}

function codec(id: string, convert: SchemanCodecOptions["convert"]): SchemanCodecOptions {
  return {
    id,
    mode: "sync",
    capabilityVersion: "1",
    configurationDigest: `sha256:${id}`,
    cacheable: true,
    convert,
  };
}

function linked(result: AdaptSchemanResult, source: string) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("adapter fixture failed");
  const parsed = parseExpression(source);
  if (!parsed.ok) throw new Error("parse fixture failed");
  const compiled = compileExpression(parsed.value, result.environment.compileProjection);
  if (!compiled.ok)
    throw new Error(`compile fixture failed: ${JSON.stringify(compiled.diagnostics)}`);
  const prepared = linkExpression(compiled.value, result.environment, result.capabilitySnapshot);
  if (!prepared.ok) throw new Error("link fixture failed");
  return prepared.value;
}

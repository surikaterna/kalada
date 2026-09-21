import { describe, expect, it } from "vitest";
import type { ManualBindingDescriptor, SerializableValue } from "./index.js";
import { normalizeManualEnvironment } from "./index.js";

describe("binding metadata normalization", () => {
  it("preserves every serializable falsy value and distinguishes omitted metadata", () => {
    const inputs: readonly [string, boolean, SerializableValue | undefined][] = [
      ["null", true, null],
      ["false", true, false],
      ["zero", true, 0],
      ["empty", true, ""],
      ["omitted", false, undefined],
    ];
    const result = normalizeManualEnvironment({
      mode: "sync",
      bindings: inputs.map(([id, present, metadata]) => binding(id, present, metadata)),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings).toHaveLength(inputs.length);
    expect(
      result.environment.bindings.map((item) => ({
        id: item.id,
        metadataPresent: Object.hasOwn(item, "metadata"),
        metadata: item.metadata,
      })),
    ).toEqual([
      { id: "null", metadataPresent: true, metadata: null },
      { id: "false", metadataPresent: true, metadata: false },
      { id: "zero", metadataPresent: true, metadata: 0 },
      { id: "empty", metadataPresent: true, metadata: "" },
      { id: "omitted", metadataPresent: false, metadata: undefined },
    ]);
  });

  it("rejects invalid metadata with one location-specific diagnostic", () => {
    const invalid = binding("invalid", true, new Date(0) as unknown as SerializableValue);
    const result = normalizeManualEnvironment({ mode: "sync", bindings: [invalid] });

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "HOST_ENVIRONMENT_INVALID_METADATA",
          bindingPath: ["invalid"],
        }),
      ],
    });
  });
});

function binding(
  id: string,
  metadataPresent: boolean,
  metadata: SerializableValue | undefined,
): ManualBindingDescriptor {
  return {
    id,
    name: id,
    path: [id],
    semanticType: "dynamic",
    ...(metadataPresent ? { metadata: metadata as SerializableValue } : {}),
  };
}

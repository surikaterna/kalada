import { describe, expect, it, vi } from "vitest";
import type { EditorObjectShape, ManualProviderInput } from "./index.js";
import {
  createManualProvider,
  describeEnvironment,
  normalizeManualEnvironment,
  traverseEditorGraph,
} from "./index.js";

function completeInput(): ManualProviderInput {
  const decode = vi.fn((value: unknown) => value);
  const convert = vi.fn((value: unknown) => value);
  const node: EditorObjectShape = {
    kind: "object",
    properties: [
      { name: "next", required: false, shape: { kind: "reference", definition: "Node" } },
      {
        name: "items",
        required: true,
        shape: {
          kind: "array",
          element: {
            kind: "tuple",
            items: [
              { kind: "scalar", name: "string" },
              {
                kind: "union",
                variants: [
                  { kind: "scalar", name: "number" },
                  { kind: "unknown", reason: "vendor keyword" },
                ],
              },
            ],
          },
        },
      },
    ],
  };
  return {
    mode: "sync",
    providerId: "manual.test",
    providerVersion: "1",
    configurationDigest: "sha256:provider",
    capabilities: [
      {
        kind: "validator",
        handle: "validate.customer",
        mode: "sync",
        capabilityId: "validator.customer",
        capabilityVersion: "1",
        configurationDigest: "sha256:validator",
        decode,
      },
      {
        kind: "codec",
        handle: "convert.customer",
        mode: "async",
        capabilityId: "codec.customer",
        capabilityVersion: "1",
        configurationDigest: "sha256:codec",
        convert,
      },
    ],
    bindings: [
      {
        id: "customer",
        name: "customer",
        path: ["input", "customer"],
        semanticType: "dynamic",
        editorShape: {
          root: { kind: "reference", definition: "Node" },
          definitions: [{ name: "Node", shape: node }],
        },
        validatorHandle: "validate.customer",
        codecHandle: "convert.customer",
        metadata: { $type: "number", label: "Customer" },
        provenance: [{ providerId: "manual.test", source: "fixture" }],
      },
      {
        id: "known",
        name: "known",
        path: ["known"],
        semanticType: { kind: "primitive-type", name: "boolean" },
        editorShape: { root: { kind: "unknown", reason: "shape unavailable" } },
      },
    ],
  };
}

describe("manual environment", () => {
  it("keeps semantic, editor, metadata, provenance, and capabilities independent", () => {
    const input = completeInput();
    const result = describeEnvironment(createManualProvider(input));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.environment.bindings.map((binding) => binding.semanticType)).toEqual([
      "dynamic",
      { kind: "primitive-type", name: "boolean" },
    ]);
    expect(result.environment.bindings[0]?.metadata).toEqual({
      $type: "number",
      label: "Customer",
    });
    expect(result.environment.bindings[0]?.semanticType).toBe("dynamic");
    expect(result.environment.capabilities.map(({ mode }) => mode)).toEqual(["sync", "async"]);
    expect(result.environment.cacheability.cacheable).toBe(true);
    expect(
      input.capabilities?.[0]?.kind === "validator" && input.capabilities[0].decode,
    ).not.toHaveBeenCalled();
  });

  it("preserves recursive graph evidence and terminates cycle-aware traversal", () => {
    const result = normalizeManualEnvironment(completeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const graph = result.environment.editorGraph;
    const steps = traverseEditorGraph(graph);
    expect(graph.roots.map(({ bindingId }) => bindingId)).toEqual(["customer", "known"]);
    expect(graph.definitions.map(({ name }) => name)).toEqual(["Node"]);
    expect(graph.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["object", "array", "tuple", "union", "reference", "unknown"]),
    );
    expect(graph.nodes.find((node) => node.kind === "object")).toMatchObject({
      properties: [
        { name: "next", required: false },
        { name: "items", required: true },
      ],
    });
    expect(
      graph.nodes.some((node) => node.kind === "reference" && node.target?.cycle === true),
    ).toBe(true);
    expect(steps.some(({ cycle }) => cycle)).toBe(true);
    expect(steps.length).toBeLessThanOrEqual(graph.limits.maxEdges + graph.limits.maxNodes);
  });

  it("keeps callbacks only in the explicit instance snapshot", () => {
    const first = normalizeManualEnvironment(completeInput());
    const second = normalizeManualEnvironment(completeInput());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(containsFunction(first.environment)).toBe(false);
    const live = first.capabilitySnapshot.capabilities["validate.customer"];
    expect(live?.kind === "validator" && typeof live.decode).toBe("function");
    expect(first.capabilitySnapshot).not.toBe(second.capabilitySnapshot);
    expectRecursivelyFrozen(first.environment);
  });

  it("marks incomplete provider or capability identity non-cacheable", () => {
    const provider = normalizeManualEnvironment({
      mode: "sync",
      providerId: "partial",
      bindings: [],
    });
    expect(provider.ok && provider.environment.cacheability).toEqual({
      cacheable: false,
      reason: "missing-identity",
    });
    const input = completeInput();
    const capability = input.capabilities?.[0];
    if (capability?.kind === "validator")
      delete (capability as { capabilityVersion?: string }).capabilityVersion;
    const result = normalizeManualEnvironment(input);
    expect(result.ok && result.environment.cacheability).toEqual({
      cacheable: false,
      reason: "capability-not-cacheable",
    });
  });
});

function containsFunction(input: unknown): boolean {
  if (typeof input === "function") return true;
  if (typeof input !== "object" || input === null) return false;
  return Object.values(input).some(containsFunction);
}

function expectRecursivelyFrozen(input: unknown): void {
  if (typeof input !== "object" || input === null) return;
  expect(Object.isFrozen(input)).toBe(true);
  for (const value of Object.values(input)) expectRecursivelyFrozen(value);
}

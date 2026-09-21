import { describe, expect, it } from "vitest";
import type {
  EditorObjectShape,
  EditorShape,
  HostDiagnostic,
  HostDiagnosticPhase,
  ManualProviderInput,
  SerializableValue,
} from "./index.js";
import {
  cloneSerializableData,
  createEditorGraph,
  normalizeManualEnvironment,
  traverseEditorGraph,
} from "./index.js";

describe("audit regressions", () => {
  it("exposes the complete immutable host diagnostic envelope", () => {
    const phases: readonly HostDiagnosticPhase[] = [
      "environment",
      "parse",
      "lower",
      "compile",
      "link",
      "bind",
      "evaluate",
    ];
    const diagnostic: HostDiagnostic = Object.freeze({
      code: "KALADA_V1_INVALID_PROGRAM",
      phase: "compile",
      message: "Compilation failed.",
      source: Object.freeze({
        uri: "memory:///expression.kalada",
        range: Object.freeze({
          start: Object.freeze({ line: 0, character: 1 }),
          end: Object.freeze({ line: 0, character: 2 }),
        }),
      }),
      cause: Object.freeze({
        phase: "parse",
        code: "KALADA_SYNTAX_EXPECTED_EXPRESSION",
        message: "Expected an expression.",
        range: Object.freeze({ start: 1, end: 2 }),
        path: Object.freeze([]),
      }),
    });
    expect(phases).toHaveLength(7);
    expect(diagnostic).toMatchObject({
      phase: "compile",
      source: { uri: "memory:///expression.kalada" },
    });
    expect(Object.isFrozen(diagnostic.cause)).toBe(true);
  });

  it("omits absent tuple rest and round-trips the normalized environment", () => {
    const result = normalizeManualEnvironment({
      mode: "sync",
      bindings: [
        {
          id: "tuple",
          name: "tuple",
          path: ["tuple"],
          semanticType: "dynamic",
          editorShape: {
            root: { kind: "tuple", items: [{ kind: "scalar", name: "string" }] },
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tuple = result.environment.editorGraph.nodes.find((node) => node.kind === "tuple");
    expect(tuple && Object.hasOwn(tuple, "rest")).toBe(false);
    expect(cloneSerializableData(result.environment)).toMatchObject({ ok: true });
  });

  it.each([new Date(0), new Map([["secret", 1]])])(
    "rejects non-plain metadata %# without data loss",
    (metadata) => {
      expect(cloneSerializableData(metadata)).toMatchObject({ ok: false, reason: "invalid-value" });
      const result = normalizeManualEnvironment({
        mode: "sync",
        bindings: [
          {
            id: "metadata",
            name: "metadata",
            path: ["metadata"],
            semanticType: "dynamic",
            metadata: metadata as unknown as SerializableValue,
          },
        ],
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: "HOST_ENVIRONMENT_INVALID_METADATA" }],
      });
    },
  );

  it("duplicates shared aliases so every descendant retains its location path", () => {
    const shared: EditorObjectShape = {
      kind: "object",
      properties: [{ name: "leaf", required: true, shape: { kind: "scalar", name: "string" } }],
    };
    const graph = createEditorGraph([
      {
        bindingId: "alias",
        path: ["alias"],
        document: {
          root: {
            kind: "object",
            properties: [
              { name: "first", required: true, shape: shared },
              { name: "second", required: true, shape: shared },
            ],
          },
        },
      },
    ]);
    const leafPaths = traverseEditorGraph(graph)
      .filter(({ path }) => path.at(-1) === "leaf")
      .map(({ path }) => path);
    expect(leafPaths).toEqual([
      ["alias", "first", "leaf"],
      ["alias", "second", "leaf"],
    ]);
    expect(new Set(graph.nodes.map(({ id }) => id)).size).toBe(graph.nodes.length);
  });

  it("bounds roots, definitions, and resolved reference edges", () => {
    const roots = createEditorGraph(
      Array.from({ length: 5 }, (_, index) => ({
        bindingId: `root-${index}`,
        path: [`root-${index}`],
        document: { root: { kind: "scalar" as const, name: "string" as const } },
      })),
      { maxEdges: 1 },
    );
    expect(roots.roots.length).toBeLessThanOrEqual(1);
    expect(roots.evidence).toContainEqual(expect.objectContaining({ code: "edge-limit" }));

    const definitions = limitedReferenceGraph(2);
    expect(definitions.definitions).toHaveLength(1);
    expect(definitions.nodes.find((node) => node.kind === "reference")).toMatchObject({
      status: "unresolved",
      evidence: [{ code: "edge-limit" }],
    });
  });

  it("marks a late recursive definition after repeated long acyclic references", () => {
    const graph = compoundReferenceGraph();
    const loopDefinition = graph.definitions.find(({ name }) => name === "Loop");
    const loopNode = graph.nodes.find(({ id }) => id === loopDefinition?.nodeId);
    const selfEdge = loopNode?.kind === "object" ? loopNode.properties[0] : undefined;
    const selfReference = graph.nodes.find(({ id }) => id === selfEdge?.nodeId);
    const metadataCycle = selfReference?.kind === "reference" && selfReference.target?.cycle;
    const traversalCycle = traverseEditorGraph(graph).some(
      ({ nodeId, cycle }) => nodeId === loopDefinition?.nodeId && cycle,
    );
    expect(graph.evidence).toEqual([]);
    expect(metadataCycle).toBe(true);
    expect(metadataCycle).toBe(traversalCycle);
  });

  it("keeps complete acyclic analysis bounded and stack-safe at its retained boundary", () => {
    const graph = repeatedAcyclicGraph(16, 128);
    const references = graph.nodes.filter((node) => node.kind === "reference");
    expect(graph.evidence).toEqual([]);
    expect(references).toHaveLength(16);
    expect(references.every((node) => node.kind === "reference" && !node.target?.cycle)).toBe(true);
    const traversal = traverseEditorGraph(graph);
    expect(traversal.length).toBeLessThanOrEqual(graph.limits.maxEdges + graph.limits.maxNodes);
    expect(traversal.some(({ cycle }) => cycle)).toBe(false);
  });

  it("does not invoke accessors in editor child collections", () => {
    let accessed = false;
    const properties: unknown[] = [];
    Object.defineProperty(properties, "0", {
      get() {
        accessed = true;
        throw new Error("must not execute");
      },
    });
    properties.length = 1;
    const input = {
      mode: "sync",
      bindings: [
        {
          id: "hostile",
          name: "hostile",
          path: ["hostile"],
          semanticType: "dynamic",
          editorShape: { root: { kind: "object", properties } },
        },
      ],
    } as unknown as ManualProviderInput;
    const result = normalizeManualEnvironment(input);
    expect(accessed).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_ENVIRONMENT_INVALID_BINDING", bindingPath: ["hostile"] }],
    });
    const graph = createEditorGraph([
      {
        bindingId: "hostile",
        path: ["hostile"],
        document: { root: { kind: "object", properties } as never },
      },
    ]);
    expect(accessed).toBe(false);
    expect(graph.nodes[0]).toMatchObject({
      kind: "unknown",
      evidence: [{ code: "invalid-shape" }],
    });
  });

  it("preserves declared provider provenance when caching is disabled", () => {
    const result = normalizeManualEnvironment({
      mode: "sync",
      providerId: "declared-provider",
      providerVersion: "7",
      cacheable: false,
      bindings: [
        { id: "duplicate", name: "first", path: ["first"], semanticType: "dynamic" },
        { id: "duplicate", name: "second", path: ["second"], semanticType: "dynamic" },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "HOST_ENVIRONMENT_DUPLICATE_BINDING",
          provenance: { providerId: "declared-provider", providerVersion: "7" },
        },
      ],
    });
  });
});

function limitedReferenceGraph(maxEdges: number) {
  return createEditorGraph(
    [
      {
        bindingId: "reference",
        path: ["reference"],
        document: {
          root: { kind: "reference", definition: "target" },
          definitions: [
            { name: "target", shape: { kind: "scalar", name: "string" } },
            { name: "extra", shape: { kind: "scalar", name: "number" } },
          ],
        },
      },
    ],
    { maxEdges },
  );
}

function compoundReferenceGraph() {
  const longReferences = Array.from({ length: 5 }, (_, index) => ({
    name: `long-${index}`,
    required: true,
    shape: { kind: "reference" as const, definition: "Long" },
  }));
  return createEditorGraph(
    [
      {
        bindingId: "compound",
        path: ["compound"],
        document: {
          root: {
            kind: "object",
            properties: [
              ...longReferences,
              { name: "loop", required: true, shape: { kind: "reference", definition: "Loop" } },
            ],
          },
          definitions: [
            { name: "Long", shape: nestedArrayShape(8) },
            {
              name: "Loop",
              shape: {
                kind: "object",
                properties: [
                  {
                    name: "self",
                    required: true,
                    shape: { kind: "reference", definition: "Loop" },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    { maxEdges: 30, maxNodes: 100, maxDepth: 32 },
  );
}

function repeatedAcyclicGraph(referenceCount: number, depth: number) {
  return createEditorGraph(
    [
      {
        bindingId: "acyclic-boundary",
        path: ["acyclic-boundary"],
        document: {
          root: {
            kind: "object",
            properties: Array.from({ length: referenceCount }, (_, index) => ({
              name: `reference-${index}`,
              required: true,
              shape: { kind: "reference" as const, definition: "Long" },
            })),
          },
          definitions: [{ name: "Long", shape: nestedArrayShape(depth) }],
        },
      },
    ],
    { maxEdges: 200, maxNodes: 180, maxDepth: 160 },
  );
}

function nestedArrayShape(depth: number): EditorShape {
  let shape: EditorShape = { kind: "scalar", name: "string" };
  for (let level = 0; level < depth; level += 1) shape = { kind: "array", element: shape };
  return shape;
}

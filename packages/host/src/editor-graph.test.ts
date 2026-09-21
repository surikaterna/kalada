import { describe, expect, it } from "vitest";
import type { EditorGraphInput, EditorObjectShape, EditorShape } from "./index.js";
import { createEditorGraph, traverseEditorGraph } from "./index.js";

describe("editor graph", () => {
  it("records native object cycles without recursive output objects", () => {
    const root = { kind: "object", properties: [] } as unknown as {
      kind: "object";
      properties: { name: string; required: boolean; shape: EditorObjectShape }[];
    };
    root.properties.push({ name: "self", required: true, shape: root });
    const graph = createEditorGraph([
      { bindingId: "recursive", path: ["recursive"], document: { root } },
    ]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      kind: "object",
      properties: [{ name: "self", nodeId: "n0", cycle: true }],
    });
    expect(traverseEditorGraph(graph).map(({ cycle }) => cycle)).toEqual([false, true]);
    expect(() => JSON.stringify(graph)).not.toThrow();
  });

  it("retains bounded unknown evidence", () => {
    const graph = createEditorGraph(
      [
        {
          bindingId: "deep",
          path: ["deep"],
          document: {
            root: {
              kind: "array",
              element: { kind: "array", element: { kind: "scalar", name: "string" } },
            },
          },
        },
      ],
      { maxDepth: 1, maxNodes: 4, maxEdges: 4 },
    );
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[2]).toMatchObject({
      kind: "unknown",
      evidence: [{ code: "depth-limit", path: ["deep", "[]", "[]"] }],
    });
  });

  it("retains a later node-limit location after an earlier depth limit", () => {
    const graph = createEditorGraph(
      [
        {
          bindingId: "deep",
          path: ["deep"],
          document: { root: nestedArray(2) },
        },
        {
          bindingId: "later",
          path: ["later"],
          document: { root: { kind: "scalar", name: "number" } },
        },
      ],
      { maxDepth: 1, maxNodes: 3, maxEdges: 8 },
    );

    expect(graph.nodes).toHaveLength(3);
    expect(graph.roots[1]).toMatchObject({ nodeId: "n2", path: ["later"] });
    expect(graph.nodes[2]).toMatchObject({
      kind: "unknown",
      evidence: [
        { code: "depth-limit", path: ["deep", "[]", "[]"] },
        { code: "node-limit", path: ["later"] },
      ],
    });
    expect(retainedEdgeCount(graph)).toBeLessThanOrEqual(graph.limits.maxEdges);
  });

  it("orders and deduplicates mixed shared unknown evidence deterministically", () => {
    const inputs: EditorGraphInput[] = [
      { bindingId: "invalid", path: ["invalid"], document: { root: null as never } },
      { bindingId: "deep", path: ["deep"], document: { root: nestedArray(2) } },
      {
        bindingId: "later",
        path: ["later"],
        document: { root: { kind: "scalar" as const, name: "number" as const } },
      },
      {
        bindingId: "later-alias",
        path: ["later"],
        document: { root: { kind: "scalar" as const, name: "boolean" as const } },
      },
    ];
    const limits = { maxDepth: 1, maxNodes: 4, maxEdges: 10 };
    const first = createEditorGraph(inputs, limits);
    const second = createEditorGraph(inputs, limits);
    const expected = [
      { code: "invalid-shape", path: ["invalid"] },
      { code: "depth-limit", path: ["deep", "[]", "[]"] },
      { code: "node-limit", path: ["later"] },
    ];

    expect(first.nodes[0]).toMatchObject({ kind: "unknown", evidence: expected });
    expect(first.nodes[0]?.evidence).toEqual(second.nodes[0]?.evidence);
    expect(first.nodes[0]?.evidence.length).toBeLessThanOrEqual(first.limits.maxEdges);
    expect(first.nodes.length).toBeLessThanOrEqual(first.limits.maxNodes);
    expect(retainedEdgeCount(first)).toBeLessThanOrEqual(first.limits.maxEdges);
  });

  it("retains distinct graph-level edge truncation locations within its bound", () => {
    const inputs = Array.from({ length: 4 }, (_, index) => ({
      bindingId: `root-${index}`,
      path: [`root-${index}`],
      document: { root: { kind: "scalar" as const, name: "string" as const } },
    }));
    const graph = createEditorGraph(inputs, { maxEdges: 2 });

    expect(graph.evidence).toEqual([
      { code: "edge-limit", path: ["root-2"] },
      { code: "edge-limit", path: [] },
    ]);
    expect(graph.evidence.length).toBeLessThanOrEqual(graph.limits.maxEdges);
    expect(createEditorGraph(inputs, { maxEdges: 2 }).evidence).toEqual(graph.evidence);
  });

  it("makes document-local IDs visibly unsuitable as cross-document fingerprints", () => {
    const make = (bindingId: string) =>
      createEditorGraph([
        {
          bindingId,
          path: [bindingId],
          document: { root: { kind: "scalar", name: "string" } },
        },
      ]);
    const first = make("first");
    const second = make("second");
    expect(first.nodeIdScope).toBe("document-local");
    expect(first.nodes[0]?.id).toBe(second.nodes[0]?.id);
    expect(first.roots[0]?.bindingId).not.toBe(second.roots[0]?.bindingId);
  });

  it("does not resolve explicitly unavailable references on definition-name collisions", () => {
    const graph = createEditorGraph([
      {
        bindingId: "collision",
        path: ["collision"],
        document: {
          root: {
            kind: "reference",
            definition: "unsupported:input",
            reference: "https://evil.test/schema",
            unresolved: "non-local-reference",
          },
          definitions: [{ name: "unsupported:input", shape: { kind: "scalar", name: "number" } }],
        },
      },
    ]);
    const reference = graph.nodes.find((node) => node.kind === "reference");

    expect(reference).toMatchObject({
      kind: "reference",
      definition: "unsupported:input",
      status: "unresolved",
      availability: "unavailable",
      unresolved: "non-local-reference",
    });
    expect(reference).not.toHaveProperty("target");
    expect(graph.admission?.resolution).toBe(0);
  });
});

function nestedArray(depth: number): EditorShape {
  let shape: EditorShape = { kind: "scalar", name: "string" };
  for (let index = 0; index < depth; index += 1) shape = { kind: "array", element: shape };
  return shape;
}

function retainedEdgeCount(graph: ReturnType<typeof createEditorGraph>): number {
  let edges = graph.roots.length + graph.definitions.length;
  for (const node of graph.nodes) {
    if (node.kind === "object") edges += node.properties.length;
    if (node.kind === "array") edges += 1;
    if (node.kind === "tuple") edges += node.items.length + (node.rest ? 1 : 0);
    if (node.kind === "union") edges += node.variants.length;
    if (node.kind === "reference" && node.target) edges += 1;
  }
  return edges;
}

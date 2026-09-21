import { describe, expect, it } from "vitest";
import type { EditorObjectShape } from "./index.js";
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
});

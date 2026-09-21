import { describe, expect, it } from "vitest";
import { createEditorGraph, traverseEditorGraph } from "./index.js";

describe("editor graph traversal", () => {
  it("enters cyclic components and stops only at a path-local revisit", () => {
    const graph = createEditorGraph([
      {
        bindingId: "cycle",
        path: ["cycle"],
        document: {
          root: { kind: "reference", definition: "A" },
          definitions: [
            { name: "A", shape: { kind: "reference", definition: "B" } },
            {
              name: "B",
              shape: {
                kind: "object",
                properties: [
                  { name: "leaf", required: true, shape: { kind: "scalar", name: "string" } },
                  { name: "back", required: true, shape: { kind: "reference", definition: "A" } },
                ],
              },
            },
          ],
        },
      },
    ]);

    expect(traverseEditorGraph(graph)).toEqual([
      step("n0", ["cycle"], 0, "root", false),
      step("n1", ["cycle"], 1, "reference", false),
      step("n2", ["cycle", "$defs", "A"], 2, "reference", false),
      step("n3", ["cycle", "$defs", "B", "leaf"], 3, "property", false),
      step("n4", ["cycle", "$defs", "B", "back"], 3, "property", false),
      step("n1", ["cycle", "$defs", "B", "back"], 4, "reference", true),
    ]);
    expect(traverseEditorGraph(graph)).toHaveLength(6);
    expect(traverseEditorGraph(graph).length).toBeLessThanOrEqual(
      graph.limits.maxEdges + graph.limits.maxNodes,
    );
  });
});

function step(
  nodeId: string,
  path: readonly (string | number)[],
  depth: number,
  via: "root" | "property" | "reference",
  cycle: boolean,
) {
  return { nodeId, path, depth, via, cycle, availability: "available" };
}

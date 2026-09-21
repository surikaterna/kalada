import { describe, expect, it } from "vitest";
import { calculateEditorGraphAdmission } from "./editor-admission.js";
import { createEditorGraph } from "./editor-graph.js";

describe("editor graph admission", () => {
  it("keeps helper costs synchronized with categorized graph charging", () => {
    const graph = createEditorGraph([
      {
        bindingId: "binding",
        path: ["value"],
        document: {
          root: { kind: "reference", definition: "root" },
          definitions: [
            {
              name: "root",
              shape: {
                kind: "object",
                properties: [
                  {
                    name: "value",
                    required: true,
                    shape: { kind: "reference", definition: "leaf" },
                  },
                ],
              },
            },
            { name: "leaf", shape: { kind: "scalar", name: "string" } },
          ],
        },
      },
    ]);
    const calculated = calculateEditorGraphAdmission({
      maxEdges: graph.limits.maxEdges,
      roots: 1,
      definitions: 2,
      children: 1,
      resolutions: 2,
    });
    expect(graph.admission).toEqual({
      budget: 8_192,
      root: 1,
      definition: 2,
      child: 1,
      resolution: 2,
      total: 6,
      remaining: 8_186,
    });
    expect(calculated).toMatchObject({
      model: { B: 8_192, D: 2, C: 1, V: 2, R: 1, Q: 0 },
      total: graph.admission?.total,
      truncated: false,
    });
  });

  it("admits backbones before optional children", () => {
    expect(
      calculateEditorGraphAdmission({
        maxEdges: 5,
        roots: 1,
        definitions: 2,
        children: 4,
        resolutions: 1,
        evidenceReserve: 1,
      }),
    ).toMatchObject({
      model: { B: 5, D: 2, C: 0, V: 1, R: 1, Q: 1 },
      backboneAdmitted: true,
      truncated: true,
      remaining: 0,
    });
  });
});

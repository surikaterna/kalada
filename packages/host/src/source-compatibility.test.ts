import { describe, expect, it } from "vitest";
import type { EditorObjectNode, EditorPropertyEdge, EditorScalarNode } from "./index.js";

describe("additive editor graph source compatibility", () => {
  it("allows existing normalized interface construction without new evidence fields", () => {
    const property: EditorPropertyEdge = {
      nodeId: "n1",
      path: ["value"],
      cycle: false,
      name: "value",
      required: true,
    };
    const scalar: EditorScalarNode = {
      id: "n1",
      path: ["value"],
      kind: "scalar",
      name: "string",
      availability: "available",
      evidence: [],
    };
    const object: EditorObjectNode = {
      id: "n0",
      path: [],
      kind: "object",
      properties: [property],
      availability: "available",
      evidence: [],
    };
    expect([object, scalar]).toHaveLength(2);
  });
});

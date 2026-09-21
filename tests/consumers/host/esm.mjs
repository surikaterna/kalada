import { createManualProvider, describeEnvironment, traverseEditorGraph } from "@kalada/host";

const outcome = describeEnvironment(
  createManualProvider({
    mode: "sync",
    bindings: [
      {
        id: "name",
        name: "name",
        path: ["name"],
        semanticType: { kind: "primitive-type", name: "string" },
        editorShape: { root: { kind: "scalar", name: "string" } },
      },
    ],
  }),
);
if (!outcome.ok) throw new Error("ESM manual provider failed");
if (traverseEditorGraph(outcome.environment.editorGraph).length !== 1) {
  throw new Error("ESM graph traversal failed");
}

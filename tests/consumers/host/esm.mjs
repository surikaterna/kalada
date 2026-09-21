import {
  createManualProvider,
  describeEnvironment,
  prepareExpression,
  traverseEditorGraph,
} from "@kalada/host";

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
const prepared = prepareExpression("name", providerFromOutcome());
if (!prepared.ok || prepared.value.evaluate({ name: "Kalada" }).value !== "Kalada") {
  throw new Error("ESM prepared execution failed");
}

function providerFromOutcome() {
  return createManualProvider({
    mode: "sync",
    bindings: [
      {
        id: "name",
        name: "name",
        path: ["name"],
        semanticType: { kind: "primitive-type", name: "string" },
      },
    ],
  });
}

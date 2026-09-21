import { createManualProvider, evaluateExpression, normalizeManualEnvironment } from "@kalada/host";

const result = normalizeManualEnvironment({
  mode: "sync",
  bindings: [{ id: "x", name: "x", path: ["x"], semanticType: "dynamic" }],
});
if (!result.ok || result.environment.bindings[0].id !== "x") {
  throw new Error("Browser host consumer failed");
}
const evaluated = evaluateExpression(
  "x",
  createManualProvider({
    mode: "sync",
    bindings: [{ id: "x", name: "x", path: ["x"], semanticType: "dynamic" }],
  }),
  { x: { browser: true } },
);
if (!evaluated.ok || evaluated.value.browser !== true) {
  throw new Error("Browser host execution failed");
}

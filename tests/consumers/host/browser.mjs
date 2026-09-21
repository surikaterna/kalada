import { normalizeManualEnvironment } from "@kalada/host";

const result = normalizeManualEnvironment({
  mode: "sync",
  bindings: [{ id: "x", name: "x", path: ["x"], semanticType: "dynamic" }],
});
if (!result.ok || result.environment.bindings[0].id !== "x") {
  throw new Error("Browser host consumer failed");
}

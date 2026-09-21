import { normalizeManualEnvironment } from "@kalada/host";

const result = normalizeManualEnvironment({
  mode: "sync",
  bindings: [{ id: "x", name: "x", path: ["x"], semanticType: "dynamic" }],
});
document.documentElement.dataset.kalada = result.ok ? "passed" : "failed";

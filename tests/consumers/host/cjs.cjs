const host = require("@kalada/host");

const outcome = host.normalizeManualEnvironment({ mode: "sync", bindings: [] });
if (!outcome.ok || outcome.environment.format !== "kalada-host-environment-v1") {
  throw new Error("CJS manual provider failed");
}
const evaluated = host.evaluateExpression(
  "value + 1",
  host.createManualProvider({
    mode: "sync",
    bindings: [
      {
        id: "value",
        name: "value",
        path: ["value"],
        semanticType: { kind: "primitive-type", name: "number" },
      },
    ],
  }),
  { value: 2 },
);
if (!evaluated.ok || evaluated.value !== 3) throw new Error("CJS execution failed");

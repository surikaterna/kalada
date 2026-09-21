const host = require("@kalada/host");

const outcome = host.normalizeManualEnvironment({ mode: "sync", bindings: [] });
if (!outcome.ok || outcome.environment.format !== "kalada-host-environment-v1") {
  throw new Error("CJS manual provider failed");
}

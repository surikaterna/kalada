const { createDiagnosticRouter } = require("@kalada/provider-routing");
const { createExpressionsDiagnosticProvider } = require("@kalada/language-service");
const result = createDiagnosticRouter([
  createExpressionsDiagnosticProvider(() => undefined),
]).diagnose("expressions", { uri: "cjs", text: "1", version: 1, environmentGeneration: "missing" });
if (result.diagnostics[0]?.code !== "EXPRESSIONS_ENVIRONMENT_UNAVAILABLE")
  throw Error("CJS opt-in failed");

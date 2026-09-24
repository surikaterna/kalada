import routing = require("@kalada/provider-routing");
const provider: routing.DiagnosticProvider = {
  languageId: "domain",
  diagnose: () => ({ status: "unsupported" }),
};
void routing.createDiagnosticRouter([provider]);

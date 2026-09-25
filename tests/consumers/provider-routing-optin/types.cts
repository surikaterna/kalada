import routing = require("@kalada/provider-routing");
import service = require("@kalada/language-service");
const provider: routing.DiagnosticProvider = service.createExpressionsDiagnosticProvider(
  () => undefined,
);
void routing.createDiagnosticRouter([provider]);

import { createExpressionsDiagnosticProvider } from "@kalada/language-service";
import { createDiagnosticRouter, type DiagnosticProvider } from "@kalada/provider-routing";

const provider: DiagnosticProvider = createExpressionsDiagnosticProvider(() => undefined);
void createDiagnosticRouter([provider]);

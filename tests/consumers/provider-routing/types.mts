import {
  createDiagnosticRouter,
  type DiagnosticProvider,
  type DocumentSnapshot,
} from "@kalada/provider-routing";

const provider: DiagnosticProvider = {
  languageId: "domain",
  diagnose: () => ({ status: "supported", diagnostics: [] }),
};
const snapshot: DocumentSnapshot = {
  uri: "file:///a",
  text: "",
  version: 0,
  environmentGeneration: "names-v1",
};
void createDiagnosticRouter([provider]).diagnose("domain", snapshot);

import host = require("@kalada/host");
import language = require("@kalada/language-service");

const service: language.LanguageService = language.createLanguageService({
  generation: 0,
  description: host.normalizeManualEnvironment({ mode: "sync", bindings: [] }),
});
const result: language.DiagnosticsOutcome = service.diagnostics("missing");
void result;

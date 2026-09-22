const host = require("@kalada/host");
const language = require("@kalada/language-service");

const description = host.normalizeManualEnvironment({ mode: "sync", bindings: [] });
const service = language.createLanguageService({ generation: 0, description });
service.openDocument({ uri: "memory:test", version: 1, text: "true" });
const result = service.diagnostics("memory:test");
if (result.kind !== "diagnostics" || result.diagnostics.length !== 0) throw new Error("CJS failed");

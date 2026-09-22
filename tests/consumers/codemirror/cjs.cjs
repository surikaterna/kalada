const host = require("@kalada/host");
const languageService = require("@kalada/language-service");
const codeMirror = require("@kalada/codemirror");

const service = languageService.createLanguageService({
  generation: 1,
  description: host.normalizeManualEnvironment({ mode: "sync", bindings: [] }),
});
const session = codeMirror.createKaladaEditorSession({
  service,
  document: { uri: "memory:///cjs.kalada", version: 1, text: "1" },
});
session.dispose();

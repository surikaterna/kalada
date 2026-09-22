import { createKaladaEditorSession } from "@kalada/codemirror";
import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

const service = createLanguageService({
  generation: 1,
  description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
});
const session = createKaladaEditorSession({
  service,
  document: { uri: "memory:///esm.kalada", version: 1, text: "1" },
});
session.replaceDocument("2");
if (service.getDocument("memory:///esm.kalada")?.version !== 2)
  throw new Error("ESM revision failed");
session.dispose();

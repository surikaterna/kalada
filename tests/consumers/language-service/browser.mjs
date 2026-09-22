import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

globalThis.languageServiceBrowserSmoke = () => {
  const description = normalizeManualEnvironment({ mode: "sync", bindings: [] });
  const service = createLanguageService({ generation: 0, description });
  service.openDocument({ uri: "browser", version: 1, text: "1+2" });
  const result = service.format("browser");
  return result.kind === "format" && result.edit?.text === "1 + 2";
};

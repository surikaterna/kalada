import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

const description = normalizeManualEnvironment({ mode: "sync", bindings: [] });
const service = createLanguageService({ generation: 0, description });
service.openDocument({ uri: "memory:test", version: 1, text: "1+2" });
const analysis = service.analyze("memory:test");
const formatting = service.format("memory:test");
if (analysis.kind !== "analysis" || analysis.diagnostics.length !== 0)
  throw new Error("ESM analysis failed");
if (formatting.kind !== "format" || formatting.edit?.text !== "1 + 2")
  throw new Error("ESM format failed");
if (!service.isCurrent(analysis)) throw new Error("ESM currentness failed");

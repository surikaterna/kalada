import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

const description = normalizeManualEnvironment({ mode: "sync", bindings: [] });
const service = createLanguageService({ generation: 0, description });
service.openDocument({ uri: "memory:test", version: 1, text: "1+2" });
const analysis = service.analyze("memory:test");
const formatting = service.format("memory:test");
const completion = service.completion("memory:test", { line: 0, character: 3 });
const hover = service.hover("memory:test", { line: 0, character: 0 });
if (analysis.kind !== "analysis" || analysis.diagnostics.length !== 0)
  throw new Error("ESM analysis failed");
if (formatting.kind !== "format" || formatting.edit?.text !== "1 + 2")
  throw new Error("ESM format failed");
if (!service.isCurrent(analysis)) throw new Error("ESM currentness failed");
if (completion.kind !== "completion" || hover.kind !== "hover")
  throw new Error("ESM tooling failed");

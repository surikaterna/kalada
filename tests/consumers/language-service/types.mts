import { normalizeManualEnvironment } from "@kalada/host";
import {
  type AnalysisOutcome,
  createLanguageService,
  type DocumentSnapshot,
  type Utf16LineIndex,
} from "@kalada/language-service";

const service = createLanguageService({
  generation: 0,
  description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
});
const document: DocumentSnapshot = service.openDocument({ uri: "types", version: 1, text: "1" });
const index: Utf16LineIndex = document.lineIndex;
const result: AnalysisOutcome = service.analyze("types");
void [index, result];

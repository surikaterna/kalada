import { normalizeManualEnvironment } from "@kalada/host";
import {
  type AnalysisOutcome,
  type CompletionOutcome,
  createLanguageService,
  type DocumentSnapshot,
  type HoverOutcome,
  type Utf16LineIndex,
} from "@kalada/language-service";

const service = createLanguageService({
  generation: 0,
  description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
});
const document: DocumentSnapshot = service.openDocument({ uri: "types", version: 1, text: "1" });
const index: Utf16LineIndex = document.lineIndex;
const result: AnalysisOutcome = service.analyze("types");
const completion: CompletionOutcome = service.completion("types", { line: 0, character: 1 });
const hover: HoverOutcome = service.hover("types", { line: 0, character: 0 });
void [index, result, completion, hover];

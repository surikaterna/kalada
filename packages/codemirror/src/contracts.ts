import type { Extension } from "@codemirror/state";
import type { DocumentOpen, DocumentSnapshot, LanguageService } from "@kalada/language-service";

export interface KaladaEditorSessionOptions {
  readonly service: LanguageService;
  readonly document: DocumentOpen;
  readonly onDocumentChange?: (snapshot: DocumentSnapshot) => void;
}

export interface KaladaEditorSession {
  readonly extension: Extension;
  readonly refreshEnvironment: () => void;
  readonly replaceDocument: (text: string) => void;
  readonly format: () => boolean;
  readonly dispose: () => void;
}

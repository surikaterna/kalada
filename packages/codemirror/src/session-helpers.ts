import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type {
  DocumentSnapshot,
  HoverResult,
  LanguageServiceDiagnostic,
} from "@kalada/language-service";
import { hoverTooltip } from "./render.js";
import { diagnosticOffsets, rangeToOffsets } from "./translation.js";

export function positionAt(document: Text, offset: number) {
  const line = document.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

export function translatedTooltip(
  result: Extract<HoverResult, { kind: "hover" }>,
  view: EditorView,
) {
  const range = result.hover ? rangeToOffsets(view.state.doc, result.hover.range) : null;
  if (!range || !result.hover) return null;
  return { ...hoverTooltip(result.hover, range.from), end: range.to };
}

export function translateDiagnostic(
  diagnostic: LanguageServiceDiagnostic,
  view: EditorView,
): Diagnostic {
  const range = diagnostic.source
    ? diagnosticOffsets(view.state.doc, diagnostic.source.range)
    : { from: 0, to: 0 };
  return { ...range, severity: "error", message: diagnostic.message };
}

export function animationWindow(view: EditorView): Window {
  const window = view.dom.ownerDocument.defaultView;
  if (!window) throw new Error("CodeMirror view has no window");
  return window;
}

export function wholeReplacement(snapshot: DocumentSnapshot, text: string) {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: snapshot.lineIndex.positionAt(snapshot.text.length),
    },
    text,
  };
}

import { StateEffect } from "@codemirror/state";
import { Decoration, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { DocumentSnapshot, HighlightResult, HighlightSpan } from "@kalada/language-service";
import { rangeToOffsets } from "./translation.js";

export const refreshHighlight = StateEffect.define<void>();

interface HighlightSnapshot {
  readonly result: HighlightResult;
  readonly document: DocumentSnapshot;
}

export function highlightExtension(request: (view: EditorView) => HighlightSnapshot | null) {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;
      constructor(view: EditorView) {
        this.refresh(view);
      }
      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.transactions.some((tx) => tx.effects.some((effect) => effect.is(refreshHighlight)))
        ) {
          this.refresh(update.view);
        }
      }
      refresh(view: EditorView): void {
        const captured = request(view);
        this.decorations = captured
          ? Decoration.set(
              captured.result.spans.flatMap((span) => {
                const offsets = translateSpan(view, captured.document, span);
                return offsets
                  ? [
                      Decoration.mark({ class: `kalada-hl-${span.kind}` }).range(
                        offsets.from,
                        offsets.to,
                      ),
                    ]
                  : [];
              }),
              true,
            )
          : Decoration.none;
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function translateSpan(view: EditorView, snapshot: DocumentSnapshot, span: HighlightSpan) {
  if (span.from < 0 || span.from >= span.to || span.to > snapshot.text.length) return null;
  const index = snapshot.lineIndex;
  const start = index.positionAt(span.from);
  const end = index.positionAt(span.to);
  if (index.offsetAt(start) !== span.from || index.offsetAt(end) !== span.to) return null;
  const offsets = rangeToOffsets(view.state.doc, { start, end });
  if (!offsets || offsets.from >= offsets.to) return null;
  return view.state.doc.sliceString(offsets.from, offsets.to, view.state.lineBreak) ===
    snapshot.text.slice(span.from, span.to)
    ? offsets
    : null;
}

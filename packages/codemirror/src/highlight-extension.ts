import { StateEffect } from "@codemirror/state";
import { Decoration, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { HighlightOutcome } from "@kalada/language-service";

export const refreshHighlight = StateEffect.define<void>();

export function highlightExtension(request: (view: EditorView) => HighlightOutcome | null) {
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
        const result = request(view);
        this.decorations =
          result?.kind === "highlight" && result.status === "current"
            ? Decoration.set(
                result.spans
                  .filter((span) => span.to <= view.state.doc.length)
                  .map((span) =>
                    Decoration.mark({ class: `kalada-hl-${span.kind}` }).range(span.from, span.to),
                  ),
                true,
              )
            : Decoration.none;
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

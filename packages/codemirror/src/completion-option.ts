import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { CompletionItem } from "@kalada/language-service";
import { rangeToOffsets } from "./translation.js";

export function completionOption(
  item: CompletionItem,
  view: EditorView,
  publishable: (view: EditorView) => boolean,
): Readonly<{ from: number; to: number; option: Completion }> | null {
  const range = rangeToOffsets(view.state.doc, item.edit.range);
  if (!range) return null;
  const option: Completion = {
    label: item.label,
    type: item.kind === "binding" ? "variable" : item.kind,
    detail: `${item.support}, ${item.presence}`,
    boost: item.support === "common" ? 10 : 0,
    apply: (target) => {
      if (!publishable(target)) return;
      const currentRange = rangeToOffsets(target.state.doc, item.edit.range);
      if (currentRange) target.dispatch({ changes: { ...currentRange, insert: item.edit.text } });
    },
  };
  return { ...range, option };
}

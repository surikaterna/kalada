import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const editorTheme = EditorView.theme(
  {
    "&": { color: "#e7edf5", backgroundColor: "#171d27" },
    ".cm-content": { caretColor: "#ffda86" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffda86", borderLeftWidth: "2px" },
    "&.cm-focused": { outline: "2px solid #7cc4ff", outlineOffset: "-2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#365779",
    },
    ".cm-activeLine": { backgroundColor: "#202b3a" },
    ".cm-tooltip": { backgroundColor: "#202837", color: "#e7edf5", border: "1px solid #7cc4ff" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "#365779",
      color: "#ffffff",
    },
    ".cm-tooltip-autocomplete ul li": { color: "#e7edf5" },
    ".cm-diagnostic": { color: "#e7edf5" },
    ".cm-lintRange-error": { textDecorationColor: "#ff9e97" },
    ".kalada-hl-reference": { color: "#9bd0ff" },
    ".kalada-hl-field": { color: "#b5e2b5" },
    ".kalada-hl-literal": { color: "#ffcc92" },
    ".kalada-hl-operator": { color: "#e8b9ff" },
    ".kalada-hl-keyword": { color: "#d5baff" },
    ".kalada-hl-punctuation": { color: "#d1dbe9" },
    ".kalada-hl-invalid, .kalada-hl-unsupported": { color: "#ffaaa5" },
  },
  { dark: true },
);

export const jsonHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.propertyName, color: "#b5e2b5" },
    { tag: tags.string, color: "#ffcc92" },
    { tag: tags.number, color: "#ffcc92" },
    { tag: tags.bool, color: "#d5baff" },
    { tag: tags.null, color: "#d5baff" },
    { tag: tags.punctuation, color: "#d1dbe9" },
  ]),
);

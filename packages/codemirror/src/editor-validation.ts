import type { Text } from "@codemirror/state";
import type { EditorEdit, EditorRange } from "./editor-contracts.js";

export function validRange(range: EditorRange, text: string): boolean {
  return (
    !!range &&
    Number.isSafeInteger(range.from) &&
    Number.isSafeInteger(range.to) &&
    range.from >= 0 &&
    range.to >= range.from &&
    range.to <= text.length &&
    !insidePair(text, range.from) &&
    !insidePair(text, range.to)
  );
}

function insidePair(text: string, offset: number): boolean {
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return (
    (previous === 13 && next === 10) ||
    (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
  );
}

export function validEdit(edit: EditorEdit, text: string): boolean {
  return validRange(edit, text) && typeof edit.text === "string";
}

export function sourceOffset(doc: Text, separator: string, offset: number): number {
  return offset + (doc.lineAt(offset).number - 1) * (separator.length - 1);
}

export function editorOffset(doc: Text, separator: string, offset: number): number {
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const start = line.from + (number - 1) * (separator.length - 1);
    if (offset <= start + line.length) return line.from + offset - start;
  }
  return doc.length;
}

import { Text } from "@codemirror/state";

export function detectLineSeparator(text: string): string {
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\r")) return "\r";
  return "\n";
}

export function textForEditor(text: string): Text {
  return Text.of(text.split(/\r\n|\r|\n/u));
}

export function textFromEditor(document: Text, lineSeparator: string): string {
  return document.sliceString(0, document.length, lineSeparator);
}

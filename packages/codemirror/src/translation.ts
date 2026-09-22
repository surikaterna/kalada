import type { Text } from "@codemirror/state";
import type { DocumentSnapshot, TextEdit, Utf16LineIndex } from "@kalada/language-service";

interface OffsetEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export function changesToEdits(
  startDoc: Text,
  newDoc: Text,
  changes: Readonly<{ iterChanges: (callback: ChangeCallback) => void }>,
  snapshot: DocumentSnapshot,
  lineSeparator = "\n",
): readonly TextEdit[] {
  const offsets: OffsetEdit[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    offsets.push({
      from: fromA,
      to: toA,
      insert: inserted.sliceString(0, inserted.length, lineSeparator),
    });
  });
  const coalesced = coalesceInserts(offsets);
  const translated = coalesced.map((edit) => offsetEdit(edit, startDoc, snapshot.lineIndex));
  if (translated.every((edit) => edit !== null)) return translated as readonly TextEdit[];
  return [wholeDocumentEdit(snapshot, newDoc.sliceString(0, newDoc.length, lineSeparator))];
}

export function rangeToOffsets(
  document: Text,
  range: TextEdit["range"],
): Readonly<{ from: number; to: number }> | null {
  const from = offsetAt(document, range.start.line, range.start.character);
  const to = offsetAt(document, range.end.line, range.end.character);
  return from === null || to === null || from > to ? null : { from, to };
}

export function diagnosticOffsets(
  document: Text,
  range: TextEdit["range"],
): Readonly<{ from: number; to: number }> {
  return rangeToOffsets(document, range) ?? { from: 0, to: 0 };
}

function offsetEdit(edit: OffsetEdit, document: Text, index: Utf16LineIndex): TextEdit | null {
  const start = positionAt(document, edit.from);
  const end = positionAt(document, edit.to);
  if (index.offsetAt(start) !== edit.from || index.offsetAt(end) !== edit.to) return null;
  return { range: { start, end }, text: edit.insert };
}

function positionAt(document: Text, offset: number) {
  const line = document.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

function offsetAt(document: Text, line: number, character: number): number | null {
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return null;
  }
  if (line >= document.lines) return null;
  const found = document.line(line + 1);
  return character <= found.length ? found.from + character : null;
}

function coalesceInserts(edits: readonly OffsetEdit[]): OffsetEdit[] {
  const output: OffsetEdit[] = [];
  for (const edit of edits) {
    const previous = output.at(-1);
    if (
      previous &&
      previous.from === edit.from &&
      previous.to === edit.to &&
      edit.from === edit.to
    ) {
      output[output.length - 1] = { ...previous, insert: `${previous.insert}${edit.insert}` };
    } else output.push(edit);
  }
  return output;
}

function wholeDocumentEdit(snapshot: DocumentSnapshot, text: string): TextEdit {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: snapshot.lineIndex.positionAt(snapshot.text.length),
    },
    text,
  };
}

type ChangeCallback = (
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
  inserted: Text,
) => void;

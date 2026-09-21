import type { Utf16Position } from "@kalada/host";
import type { Utf16LineIndex } from "./contracts.js";
import { LanguageServiceError } from "./errors.js";

interface LineBounds {
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

export function createUtf16LineIndex(text: string): Utf16LineIndex {
  const bounds = scanLines(text);
  return Object.freeze({
    lineCount: bounds.starts.length,
    positionAt: (offset: number) => positionAt(offset, text.length, bounds),
    offsetAt: (position: Utf16Position) => offsetAt(position, bounds),
  });
}

function scanLines(text: string): LineBounds {
  const starts = [0];
  const ends: number[] = [];
  for (let offset = 0; offset < text.length; offset += 1) {
    const width = newlineWidth(text, offset);
    if (width === 0) continue;
    ends.push(offset);
    offset += width - 1;
    starts.push(offset + 1);
  }
  ends.push(text.length);
  return { starts: Object.freeze(starts), ends: Object.freeze(ends) };
}

function newlineWidth(text: string, offset: number): number {
  const unit = text.charCodeAt(offset);
  if (unit === 10) return 1;
  if (unit !== 13) return 0;
  return text.charCodeAt(offset + 1) === 10 ? 2 : 1;
}

function positionAt(offset: number, length: number, bounds: LineBounds): Utf16Position {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) invalidRange();
  let low = 0;
  let high = bounds.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((bounds.starts[middle] as number) <= offset) low = middle;
    else high = middle - 1;
  }
  const start = bounds.starts[low] as number;
  const end = bounds.ends[low] as number;
  return Object.freeze({ line: low, character: Math.min(offset, end) - start });
}

function offsetAt(position: Utf16Position, bounds: LineBounds): number {
  const { line, character } = position;
  if (!validCoordinate(line) || !validCoordinate(character)) invalidRange();
  const start = bounds.starts[line];
  const end = bounds.ends[line];
  if (start === undefined || end === undefined || character > end - start) invalidRange();
  return start + character;
}

function validCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalidRange(): never {
  throw new LanguageServiceError("INVALID_RANGE");
}

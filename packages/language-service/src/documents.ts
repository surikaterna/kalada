import type { DocumentOpen, DocumentSnapshot, DocumentUpdate, TextEdit } from "./contracts.js";
import { LanguageServiceError } from "./errors.js";
import { createUtf16LineIndex } from "./line-index.js";

interface OffsetEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export class DocumentStore {
  readonly documents = new Map<string, DocumentSnapshot>();
  private readonly highWater = new Map<string, number>();

  open(input: DocumentOpen): DocumentSnapshot {
    validUri(input.uri);
    validVersion(input.version);
    if (this.documents.has(input.uri)) throw new LanguageServiceError("DUPLICATE_DOCUMENT");
    this.assertMonotonic(input.uri, input.version);
    if (typeof input.text !== "string") throw new TypeError("Document text must be a string");
    return this.commit(input.uri, input.version, input.text);
  }

  update(input: DocumentUpdate): DocumentSnapshot {
    validUri(input.uri);
    validVersion(input.version);
    const current = this.require(input.uri);
    this.assertMonotonic(input.uri, input.version);
    const edits = prepareEdits(input.edits, current);
    return this.commit(input.uri, input.version, applyEdits(current.text, edits));
  }

  close(uri: string): DocumentSnapshot {
    validUri(uri);
    const current = this.require(uri);
    this.documents.delete(uri);
    return current;
  }

  require(uri: string): DocumentSnapshot {
    validUri(uri);
    const found = this.documents.get(uri);
    if (!found) throw new LanguageServiceError("DOCUMENT_NOT_OPEN");
    return found;
  }

  private assertMonotonic(uri: string, version: number): void {
    const previous = this.highWater.get(uri);
    if (previous !== undefined && version <= previous) {
      throw new LanguageServiceError("VERSION_NOT_MONOTONIC");
    }
  }

  private commit(uri: string, version: number, text: string): DocumentSnapshot {
    const snapshot = Object.freeze({ uri, version, text, lineIndex: createUtf16LineIndex(text) });
    this.documents.set(uri, snapshot);
    this.highWater.set(uri, version);
    return snapshot;
  }
}

function prepareEdits(edits: readonly TextEdit[], snapshot: DocumentSnapshot): OffsetEdit[] {
  if (!Array.isArray(edits)) throw new TypeError("Document edits must be an array");
  const prepared = edits.map((edit) => prepareEdit(edit, snapshot));
  prepared.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1] as OffsetEdit;
    const current = prepared[index] as OffsetEdit;
    if (current.start < previous.end || current.start === previous.start) {
      throw new LanguageServiceError("OVERLAPPING_EDITS");
    }
  }
  return prepared;
}

function prepareEdit(edit: TextEdit, snapshot: DocumentSnapshot): OffsetEdit {
  if (typeof edit?.text !== "string") throw new TypeError("Edit text must be a string");
  const start = snapshot.lineIndex.offsetAt(edit.range.start);
  const end = snapshot.lineIndex.offsetAt(edit.range.end);
  if (start > end) throw new LanguageServiceError("INVALID_RANGE");
  return Object.freeze({ start, end, text: edit.text });
}

function applyEdits(text: string, edits: readonly OffsetEdit[]): string {
  let output = text;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index] as OffsetEdit;
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  return output;
}

export function validUri(uri: string): void {
  if (typeof uri !== "string" || uri.length === 0) throw new LanguageServiceError("INVALID_URI");
}

export function validVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new LanguageServiceError("INVALID_VERSION");
  }
}

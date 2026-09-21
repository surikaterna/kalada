import type { DocumentOpen, DocumentSnapshot, DocumentUpdate, TextEdit } from "./contracts.js";
import { LanguageServiceError } from "./errors.js";
import { createUtf16LineIndex } from "./line-index.js";

interface OffsetEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface DocumentOpenSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
}

interface DocumentUpdateSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly edits: readonly TextEdit[];
}

export class DocumentStore {
  readonly documents = new Map<string, DocumentSnapshot>();
  private readonly highWater = new Map<string, number>();

  open(input: DocumentOpen): DocumentSnapshot {
    const snapshot = snapshotOpen(input);
    this.assertAvailable(snapshot.uri, snapshot.version);
    const document = createDocument(snapshot.uri, snapshot.version, snapshot.text);
    this.assertAvailable(snapshot.uri, snapshot.version);
    return this.commit(document);
  }

  update(input: DocumentUpdate): DocumentSnapshot {
    const snapshot = snapshotUpdate(input);
    const current = this.require(snapshot.uri);
    this.assertMonotonic(snapshot.uri, snapshot.version);
    const edits = prepareEdits(snapshot.edits, current);
    const text = applyEdits(current.text, edits);
    const document = createDocument(snapshot.uri, snapshot.version, text);
    this.assertUnchanged(snapshot.uri, snapshot.version, current);
    return this.commit(document);
  }

  close(uri: string): DocumentSnapshot {
    validUri(uri);
    const current = this.require(uri);
    if (this.documents.get(uri) !== current) throw new LanguageServiceError("DOCUMENT_NOT_OPEN");
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

  private assertAvailable(uri: string, version: number): void {
    if (this.documents.has(uri)) throw new LanguageServiceError("DUPLICATE_DOCUMENT");
    this.assertMonotonic(uri, version);
  }

  private assertUnchanged(uri: string, version: number, expected: DocumentSnapshot): void {
    if (this.documents.get(uri) !== expected) {
      throw new LanguageServiceError("VERSION_NOT_MONOTONIC");
    }
    this.assertMonotonic(uri, version);
  }

  private commit(snapshot: DocumentSnapshot): DocumentSnapshot {
    this.documents.set(snapshot.uri, snapshot);
    this.highWater.set(snapshot.uri, snapshot.version);
    return snapshot;
  }
}

function snapshotOpen(input: DocumentOpen): DocumentOpenSnapshot {
  return containInput(() => {
    const uri = input.uri;
    const version = input.version;
    const text = input.text;
    validUri(uri);
    validVersion(version);
    if (typeof text !== "string") throw new TypeError("Document text must be a string");
    return Object.freeze({ uri, version, text });
  });
}

function snapshotUpdate(input: DocumentUpdate): DocumentUpdateSnapshot {
  return containInput(() => {
    const uri = input.uri;
    const version = input.version;
    const edits = snapshotEdits(input.edits);
    validUri(uri);
    validVersion(version);
    return Object.freeze({ uri, version, edits });
  });
}

function snapshotEdits(edits: readonly TextEdit[]): readonly TextEdit[] {
  if (!Array.isArray(edits)) throw new TypeError("Document edits must be an array");
  const snapshots: TextEdit[] = [];
  const length = edits.length;
  for (let index = 0; index < length; index += 1) {
    const edit = edits[index];
    if (!edit) throw new TypeError("Document edits must be dense");
    snapshots.push(snapshotEdit(edit));
  }
  return Object.freeze(snapshots);
}

function snapshotEdit(edit: TextEdit): TextEdit {
  const range = edit.range;
  const text = edit.text;
  const start = range.start;
  const end = range.end;
  const startPosition = Object.freeze({ line: start.line, character: start.character });
  const endPosition = Object.freeze({ line: end.line, character: end.character });
  if (typeof text !== "string") throw new TypeError("Edit text must be a string");
  return Object.freeze({
    range: Object.freeze({ start: startPosition, end: endPosition }),
    text,
  });
}

function containInput<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof LanguageServiceError || error instanceof TypeError) throw error;
    throw new TypeError("Language service input could not be read");
  }
}

function createDocument(uri: string, version: number, text: string): DocumentSnapshot {
  return Object.freeze({ uri, version, text, lineIndex: createUtf16LineIndex(text) });
}

function prepareEdits(edits: readonly TextEdit[], snapshot: DocumentSnapshot): OffsetEdit[] {
  if (!Array.isArray(edits)) throw new TypeError("Document edits must be an array");
  const prepared = edits.map((edit) => prepareEdit(edit, snapshot));
  prepared.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1];
    const current = prepared[index];
    if (!previous || !current) continue;
    if (current.start < previous.end || current.start === previous.start) {
      throw new LanguageServiceError("OVERLAPPING_EDITS");
    }
  }
  return prepared;
}

function prepareEdit(edit: TextEdit, snapshot: DocumentSnapshot): OffsetEdit {
  const start = snapshot.lineIndex.offsetAt(edit.range.start);
  const end = snapshot.lineIndex.offsetAt(edit.range.end);
  if (start > end) throw new LanguageServiceError("INVALID_RANGE");
  return Object.freeze({ start, end, text: edit.text });
}

function applyEdits(text: string, edits: readonly OffsetEdit[]): string {
  let output = text;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    if (!edit) continue;
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

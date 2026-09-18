import { parseException } from "./exception-schema.js";
import { validateV1Exception } from "./exception-v1.js";
import { validateV2Exception } from "./exception-v2.js";
import { readAt } from "./git.js";
import type { DiffEntry, ReleaseException } from "./types.js";

const recordPath = /^release-exceptions\/(?!schema\.v\d+\.json$)[^/]+\.json$/u;

export function addedException(
  repository: string,
  head: string,
  entries: DiffEntry[],
): { path: string; record: ReleaseException } | undefined {
  const records = entries.filter(({ path }) => recordPath.test(path));
  if (records.some(({ status }) => status !== "A")) {
    throw new Error("Existing release exception records are immutable");
  }
  if (records.length > 1) throw new Error("Only one release exception record may be added");
  const entry = records[0];
  if (!entry) return undefined;
  return {
    path: entry.path,
    record: parseException(readAt(repository, head, entry.path), entry.path),
  };
}

export function validateException(
  repository: string,
  base: string,
  head: string,
  repositoryName: string,
  entries: DiffEntry[],
  exception: { path: string; record: ReleaseException },
  affected: Set<string>,
  validationTime: number,
): void {
  const { path, record } = exception;
  if (record.schemaVersion === 1) {
    validateV1Exception(repository, base, head, repositoryName, entries, path, record, affected);
    return;
  }
  validateV2Exception(
    repository,
    base,
    head,
    repositoryName,
    entries,
    path,
    record,
    affected,
    validationTime,
  );
}

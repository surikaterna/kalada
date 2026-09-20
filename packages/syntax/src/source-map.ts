import type { KaladaSourceRange } from "./cst-types.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import type { KaladaSourceMapEntry, KaladaSourceMapRole } from "./public-types.js";

const ROLE_ORDER: Readonly<Record<KaladaSourceMapRole, number>> = Object.freeze({
  node: 0,
  operator: 1,
  literal: 2,
  reference: 3,
  field: 4,
  group: 5,
});

export function addMap(
  entries: KaladaSourceMapEntry[],
  path: readonly (string | number)[],
  role: KaladaSourceMapRole,
  range: KaladaSourceRange,
): void {
  entries.push({ path: [...path], role, range: freezeRange(range.start, range.end) });
}

export function widenNode(
  entries: KaladaSourceMapEntry[],
  path: readonly (string | number)[],
  range: KaladaSourceRange,
): void {
  const index = entries.findIndex((entry) => entry.role === "node" && equalPath(entry.path, path));
  if (index < 0) return;
  const found = entries[index] as KaladaSourceMapEntry;
  entries[index] = { ...found, range: freezeRange(range.start, range.end) };
}

export function finishMap(entries: KaladaSourceMapEntry[]): readonly KaladaSourceMapEntry[] {
  entries.sort(compareEntries);
  return deepFreeze(entries);
}

export function rangeForPath(
  entries: readonly KaladaSourceMapEntry[],
  path: readonly (string | number)[],
  fallback: KaladaSourceRange,
): KaladaSourceRange {
  const exact = entries.filter((entry) => equalPath(entry.path, path)).sort(preferNarrow)[0];
  if (exact) return exact.range;
  for (let length = path.length - 1; length >= 1; length -= 1) {
    const ancestor = path.slice(0, length);
    const found = entries.find((entry) => entry.role === "node" && equalPath(entry.path, ancestor));
    if (found) return found.range;
  }
  return fallback;
}

function compareEntries(left: KaladaSourceMapEntry, right: KaladaSourceMapEntry): number {
  return (
    left.range.start - right.range.start ||
    left.range.end - right.range.end ||
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
    pathKey(left.path).localeCompare(pathKey(right.path))
  );
}

function preferNarrow(left: KaladaSourceMapEntry, right: KaladaSourceMapEntry): number {
  const leftLength = left.range.end - left.range.start;
  const rightLength = right.range.end - right.range.start;
  return leftLength - rightLength || ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
}

function equalPath(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function pathKey(path: readonly (string | number)[]): string {
  return JSON.stringify(path);
}

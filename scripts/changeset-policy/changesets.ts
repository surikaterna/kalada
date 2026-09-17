import { parseChangesetFile } from "@changesets/parse";
import { readAt } from "./git.js";
import type { DiffEntry } from "./types.js";

const changesetPath = /^\.changeset\/[^/]+\.md$/u;

export function addedChangesets(entries: DiffEntry[]): DiffEntry[] {
  return entries.filter(({ path, status }) => status === "A" && changesetPath.test(path));
}

export function changedPackagesFromChangesets(
  repository: string,
  head: string,
  entries: DiffEntry[],
  workspacePackages: Set<string>,
): Set<string> {
  const packages = new Set<string>();
  for (const { path } of addedChangesets(entries)) {
    const text = readAt(repository, head, path).toString("utf8");
    const releases = parseChangeset(text, path);
    if (releases.length === 0) throw new Error(`${path} must be a non-empty Changeset`);
    for (const { name } of releases) {
      if (!workspacePackages.has(name)) {
        throw new Error(
          `${path} declares package ${name} which is not in the publishable workspace`,
        );
      }
      packages.add(name);
    }
  }
  return packages;
}

function parseChangeset(text: string, path: string) {
  try {
    return parseChangesetFile(text).releases;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not a valid Changeset: ${detail}`, { cause: error });
  }
}

export function assertNoChangedEmptyChangesets(
  repository: string,
  head: string,
  entries: DiffEntry[],
): void {
  for (const entry of entries.filter(({ path }) => changesetPath.test(path))) {
    if (entry.status !== "A") throw new Error(`Ordinary PR may not edit or delete ${entry.path}`);
    const text = readAt(repository, head, entry.path).toString("utf8");
    if (/^---\n\s*---/u.test(text)) throw new Error(`${entry.path} must not be empty`);
  }
}

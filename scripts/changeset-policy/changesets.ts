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
    const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/u.exec(text.trim());
    if (!match?.[1]?.trim() || !match[2]?.trim())
      throw new Error(`${path} must be a non-empty Changeset`);
    for (const line of match[1].split("\n")) {
      const item = /^['"]?([^'"]+)['"]?:\s*(patch|minor|major)$/u.exec(line.trim());
      if (!item?.[1]) throw new Error(`${path} has unsupported frontmatter`);
      if (!workspacePackages.has(item[1])) {
        throw new Error(
          `${path} declares package ${item[1]} which is not in the publishable workspace`,
        );
      }
      packages.add(item[1]);
    }
  }
  return packages;
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

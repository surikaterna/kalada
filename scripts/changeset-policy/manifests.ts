import { git, readAt } from "./git.js";
import type { DiffEntry, PackageManifest } from "./types.js";

export function parseManifest(value: Buffer, path: string): PackageManifest {
  try {
    return JSON.parse(value.toString("utf8")) as PackageManifest;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

export function publishablePackages(
  repository: string,
  commit: string,
): Map<string, { name: string; path: string }> {
  const paths = git(repository, ["ls-tree", "-r", "--name-only", commit]).toString().split("\n");
  const result = new Map<string, { name: string; path: string }>();
  for (const path of paths.filter((item) => /^packages\/[^/]+\/package\.json$/u.test(item))) {
    const manifest = parseManifest(readAt(repository, commit, path), path);
    if (manifest.name && !manifest.private)
      result.set(path.split("/").slice(0, 2).join("/"), { name: manifest.name, path });
  }
  return result;
}

export function affectedPackages(
  entries: DiffEntry[],
  packages: Map<string, { name: string; path: string }>,
): Set<string> {
  const affected = new Set<string>();
  for (const entry of entries) {
    const root = entry.path.split("/").slice(0, 2).join("/");
    const pkg = packages.get(root);
    if (pkg && isPublishableChange(entry.path)) affected.add(pkg.name);
  }
  return affected;
}

function isPublishableChange(path: string): boolean {
  if (/(^|\/)(__tests__|tests?)\//u.test(path)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false;
  if (/\/(README|CHANGELOG)\.md$/u.test(path)) return false;
  return true;
}

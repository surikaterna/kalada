import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { DiffEntry } from "./types.js";

export function git(repository: string, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: repository, encoding: "buffer" });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export function assertCommit(repository: string, commit: string, label: string): void {
  const actual = git(repository, ["rev-parse", "--verify", `${commit}^{commit}`])
    .toString()
    .trim();
  if (actual !== commit) throw new Error(`${label} must be an immutable 40-character commit SHA`);
}

export function commitTimestamp(repository: string, commit: string): number {
  const value = git(repository, ["show", "-s", "--format=%cI", commit]).toString().trim();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Commit ${commit} has an invalid timestamp`);
  return timestamp;
}

export function diffEntries(repository: string, base: string, head: string): DiffEntry[] {
  const fields = git(repository, ["diff", "--raw", "--no-renames", "-z", base, head])
    .toString()
    .split("\0")
    .filter(Boolean);
  if (fields.length % 2 !== 0) throw new Error("Could not parse diff");
  const entries: DiffEntry[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    entries.push(parseEntry(fields[index] ?? "", fields[index + 1]));
  }
  return entries;
}

function parseEntry(metadata: string, path?: string): DiffEntry {
  const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([ADM])$/u.exec(metadata);
  if (!match || !path) throw new Error("Diff contains a rename, copy, or unsupported change");
  return {
    baseMode: match[1] ?? "",
    headMode: match[2] ?? "",
    status: match[3] as DiffEntry["status"],
    path,
  };
}

export function readAt(repository: string, commit: string, path: string): Buffer {
  return git(repository, ["show", `${commit}:${path}`]);
}

export function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

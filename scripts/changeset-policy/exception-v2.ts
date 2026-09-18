import { isUtcRfc3339 } from "./exception-v1.js";
import { commitTimestamp, git, readAt, sha256 } from "./git.js";
import { parseManifest } from "./manifests.js";
import type { DiffEntry, V2ExceptionFile, V2ReleaseException } from "./types.js";

const maximumEvidenceLifetime = 24 * 60 * 60 * 1000;

export function validateV2Exception(
  repository: string,
  base: string,
  head: string,
  repositoryName: string,
  entries: DiffEntry[],
  recordPath: string,
  record: V2ReleaseException,
  affected: Set<string>,
): void {
  assertAuthorization(record, base, repositoryName);
  assertPackageIdentity(repository, base, head, record);
  if (affected.size !== 1 || !affected.has(record.package.name)) {
    throw new Error("An exception must cover exactly one otherwise-uncovered package");
  }
  const packageRoot = record.package.path.slice(0, -"/package.json".length);
  assertNoPackageRenames(repository, base, head, packageRoot);
  const packageEntries = entries.filter(({ path }) => path.startsWith(`${packageRoot}/`));
  assertFileManifest(repository, base, head, packageEntries, record);
  assertEvidence(repository, base, record);
  if (entries.some(({ path }) => path === recordPath && path.startsWith(`${packageRoot}/`))) {
    throw new Error("Exception records must be outside the package workspace");
  }
}

function assertNoPackageRenames(
  repository: string,
  base: string,
  head: string,
  packageRoot: string,
): void {
  const fields = git(repository, ["diff", "--name-status", "--find-renames=1%", "-z", base, head])
    .toString()
    .split("\0")
    .filter(Boolean);
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index] ?? "";
    const firstPath = fields[index + 1] ?? "";
    if (!status.startsWith("R")) continue;
    const secondPath = fields[index + 2] ?? "";
    if ([firstPath, secondPath].some((path) => path.startsWith(`${packageRoot}/`))) {
      throw new Error("Renames are forbidden in exception package changes");
    }
    index += 1;
  }
}

function assertAuthorization(record: V2ReleaseException, base: string, repository: string): void {
  if (record.repository !== repository)
    throw new Error("Exception repository does not match CI input");
  if (record.authorization.baseCommit !== base)
    throw new Error("Authorization base commit does not match the PR base");
  for (const url of [
    record.authorization.issueUrl,
    record.reviewIssueUrl,
    record.removalIssueUrl,
  ]) {
    if (!url.startsWith(`https://github.com/${repository}/issues/`)) {
      throw new Error("Authorization, review, and removal issues must belong to this repository");
    }
  }
}

function assertFileManifest(
  repository: string,
  base: string,
  head: string,
  entries: DiffEntry[],
  record: V2ReleaseException,
): void {
  if (entries.length !== record.files.length) {
    throw new Error("Exception must declare every changed package file and no other files");
  }
  const declaredPaths = new Set(record.files.map(({ path }) => path));
  if (declaredPaths.size !== record.files.length) throw new Error("Duplicate exception file path");
  for (const declaration of record.files)
    assertSafePackagePath(declaration.path, record.package.path);
  for (const entry of entries) {
    const declaration = record.files.find(({ path }) => path === entry.path);
    if (!declaration) throw new Error(`Undeclared exception file ${entry.path}`);
    assertFile(repository, base, head, entry, declaration);
  }
}

function assertSafePackagePath(path: string, manifestPath: string): void {
  const root = manifestPath.slice(0, -"/package.json".length);
  if (!path.startsWith(`${root}/`) || /(?:^|\/)\.\.?\//u.test(path) || /[*?[\]{}]/u.test(path)) {
    throw new Error(`Exception path ${path} is outside the named package or contains a wildcard`);
  }
}

function assertFile(
  repository: string,
  base: string,
  head: string,
  entry: DiffEntry,
  declaration: V2ExceptionFile,
): void {
  const expectedStatus = { A: "add", M: "mod", D: "del" }[entry.status];
  if (declaration.status !== expectedStatus) throw new Error(`Status mismatch for ${entry.path}`);
  assertRegularFile(entry);
  const before = entry.status === "A" ? null : readAt(repository, base, entry.path);
  const after = entry.status === "D" ? null : readAt(repository, head, entry.path);
  if (before?.includes(0) || after?.includes(0))
    throw new Error("Binary exception files are forbidden");
  if (hash(before) !== declaration.baseSha256 || hash(after) !== declaration.headSha256) {
    throw new Error(`Hash mismatch for ${entry.path}`);
  }
}

function assertRegularFile(entry: DiffEntry): void {
  const modes = [entry.baseMode, entry.headMode].filter((mode) => mode !== "000000");
  if (modes.some((mode) => mode !== "100644")) {
    throw new Error("Symlinks and executable files are forbidden in exception changes");
  }
}

function hash(value: Buffer | null): string | null {
  return value ? sha256(value) : null;
}

function assertPackageIdentity(
  repository: string,
  base: string,
  head: string,
  record: V2ReleaseException,
): void {
  const { path, name, version } = record.package;
  const before = parseManifest(readAt(repository, base, path), path);
  const after = parseManifest(readAt(repository, head, path), path);
  if (before.name !== name || after.name !== name) {
    throw new Error("Package name must remain unchanged and match the exception");
  }
  if (before.version !== version || after.version !== version) {
    throw new Error("Package version must remain unchanged and match the exception");
  }
}

function assertEvidence(repository: string, base: string, record: V2ReleaseException): void {
  const evidence = record.registryEvidence;
  if (evidence.package !== record.package.name || evidence.version !== record.package.version) {
    throw new Error("Registry evidence must identify the exact exception package and version");
  }
  if (evidence.command !== `npm view ${evidence.package}@${evidence.version} version --json`) {
    throw new Error("Registry evidence command is not canonical");
  }
  if (sha256(Buffer.from(evidence.response, "utf8")) !== evidence.responseSha256) {
    throw new Error("Registry evidence response hash does not match");
  }
  assertNotFoundResponse(evidence.response);
  assertEvidenceWindow(commitTimestamp(repository, base), evidence.capturedAt, record.expiresAt);
}

function assertNotFoundResponse(response: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error("Registry evidence response must be JSON E404 output");
  }
  const error = isObject(parsed) && isObject(parsed.error) ? parsed.error : undefined;
  if (error?.code !== "E404") {
    throw new Error("Registry evidence does not prove that the package version is unpublished");
  }
}

function assertEvidenceWindow(baseTime: number, capturedAt: string, expiresAt: string): void {
  if (!isUtcRfc3339(capturedAt) || !isUtcRfc3339(expiresAt)) {
    throw new Error("Evidence and expiry must be valid UTC RFC3339 timestamps");
  }
  const captured = Date.parse(capturedAt);
  const expiry = Date.parse(expiresAt);
  if (captured <= baseTime) throw new Error("Registry evidence must be captured after the PR base");
  if (expiry <= captured || expiry - captured > maximumEvidenceLifetime) {
    throw new Error("Registry evidence expiry must be within 24 hours of capture");
  }
  if (Date.now() >= expiry) throw new Error("Registry evidence is stale");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

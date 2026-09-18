import { readAt, sha256 } from "./git.js";
import { parseManifest } from "./manifests.js";
import type { DiffEntry, PackageManifest, V1ReleaseException } from "./types.js";

export function validateV1Exception(
  repository: string,
  base: string,
  head: string,
  repositoryName: string,
  entries: DiffEntry[],
  recordPath: string,
  record: V1ReleaseException,
  affected: Set<string>,
): void {
  assertIdentity(record, base, repositoryName);
  if (!affected.has(record.package.name)) throw new Error("Exception package is not affected");
  const authorized = entries.filter((entry) => entry.path !== recordPath);
  if (authorized.length !== record.files.length)
    throw new Error("Exception must declare every changed file");
  for (const entry of authorized) validateAuthorizedFile(repository, base, head, entry, record);
  validateManifest(repository, base, head, record);
  validateEvidence(record);
}

function assertIdentity(record: V1ReleaseException, base: string, repository: string): void {
  if (record.repository !== repository)
    throw new Error("Exception repository does not match CI input");
  if (record.baseCommit !== base) throw new Error("Exception base commit does not match CI input");
  if (record.issue.split("/issues/")[0] !== `https://github.com/${repository}`) {
    throw new Error("Exception issue must belong to this repository");
  }
}

function validateAuthorizedFile(
  repository: string,
  base: string,
  head: string,
  entry: DiffEntry,
  record: V1ReleaseException,
): void {
  if (entry.status !== "M")
    throw new Error("Exception files may not be added, deleted, or renamed");
  if (entry.baseMode !== "100644" || entry.headMode !== "100644")
    throw new Error("Symlinks are forbidden");
  const declaration = record.files.find(({ path }) => path === entry.path);
  if (!declaration) throw new Error(`Undeclared exception file ${entry.path}`);
  const before = readAt(repository, base, entry.path);
  const after = readAt(repository, head, entry.path);
  if (before.includes(0) || after.includes(0))
    throw new Error("Binary exception files are forbidden");
  if (sha256(before) !== declaration.baseSha256 || sha256(after) !== declaration.headSha256) {
    throw new Error(`Hash mismatch for ${entry.path}`);
  }
  assertChangeClass(entry.path, declaration.changeClass, record.package.path);
}

function assertChangeClass(path: string, changeClass: string, manifestPath: string): void {
  if (changeClass === "package-manifest-repository" && path !== manifestPath) {
    throw new Error("package-manifest-repository must identify the package manifest");
  }
  if (changeClass === "package-verification" && !isVerificationPath(path)) {
    throw new Error("package-verification must identify a test or verification script");
  }
}

function isVerificationPath(path: string): boolean {
  return (
    /^scripts\/[^/]*(?:smoke|verif(?:y|ication))[^/]*\.[cm]?[jt]s$/iu.test(path) ||
    /(^|\/)(__tests__|tests?)\//u.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function validateManifest(
  repository: string,
  base: string,
  head: string,
  record: V1ReleaseException,
): void {
  const { package: pkg } = record;
  const beforeBytes = readAt(repository, base, pkg.path);
  const afterBytes = readAt(repository, head, pkg.path);
  if (
    sha256(beforeBytes) !== pkg.baseManifestSha256 ||
    sha256(afterBytes) !== pkg.headManifestSha256
  ) {
    throw new Error("Manifest hash does not match exception record");
  }
  const before = parseManifest(beforeBytes, pkg.path);
  const after = parseManifest(afterBytes, pkg.path);
  assertManifestIdentity(before, after, pkg.name, pkg.version);
  if (JSON.stringify(after.repository) !== JSON.stringify(pkg.repository)) {
    throw new Error("Manifest repository does not match exception record");
  }
  const expectedUrl = `https://github.com/${record.repository}`;
  const expectedDirectory = pkg.path.slice(0, -"/package.json".length);
  if (pkg.repository.url !== expectedUrl || pkg.repository.directory !== expectedDirectory) {
    throw new Error("Manifest repository does not identify this package and repository");
  }
}

function assertManifestIdentity(
  before: PackageManifest,
  after: PackageManifest,
  name: string,
  version: string,
): void {
  if (
    before.name !== name ||
    after.name !== name ||
    before.version !== version ||
    after.version !== version
  ) {
    throw new Error("Package name and version must remain unchanged");
  }
  const beforeWithoutRepository = { ...before, repository: undefined };
  const afterWithoutRepository = { ...after, repository: undefined };
  if (JSON.stringify(beforeWithoutRepository) !== JSON.stringify(afterWithoutRepository)) {
    throw new Error("Only the manifest repository field may change");
  }
}

function validateEvidence(record: V1ReleaseException): void {
  const evidence = record.observedRegistryEvidence;
  if (evidence.package !== record.package.name || evidence.version !== record.package.version) {
    throw new Error("Registry evidence must identify the corrected package version");
  }
  if (evidence.command !== `npm view ${evidence.package}@${evidence.version} version --json`) {
    throw new Error("Registry evidence command is not canonical");
  }
  if (sha256(Buffer.from(evidence.response, "utf8")) !== evidence.responseSha256) {
    throw new Error("Registry evidence response hash does not match");
  }
  if (!isUtcRfc3339(evidence.capturedAt)) throw new Error("Registry evidence timestamp is invalid");
}

export function isUtcRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined || second === undefined)
    return false;
  if (month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

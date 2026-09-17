import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Bump = "major" | "minor" | "patch";
type Change = { bump: Bump; description: string; packageName: string };
type DiffEntry = { path: string; status: string };
type Manifest = { name?: string; private?: boolean; version?: string; [key: string]: unknown };

const bumpRank: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

function git(repository: string, args: string[], allowMissing = false): string | undefined {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  if (result.status === 0) return result.stdout;
  if (allowMissing) return undefined;
  throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
}

function diffEntries(repository: string, base: string): DiffEntry[] {
  const output = git(repository, ["diff", "--name-status", "--no-renames", "-z", `${base}..HEAD`]);
  const fields = output?.split("\0").filter(Boolean) ?? [];
  if (fields.length % 2 !== 0) throw new Error("Could not parse release diff");
  const entries: DiffEntry[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ status: fields[index] ?? "", path: fields[index + 1] ?? "" });
  }
  return entries;
}

function parseChangeset(text: string, path: string): Change[] {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/u.exec(text.trim());
  if (!match) throw new Error(`${path} is not a valid Changeset`);
  const description = match[2]?.trim() ?? "";
  if (!description) throw new Error(`${path} has no changelog description`);
  return (match[1] ?? "").split("\n").map((line) => {
    const entry = /^['"]?([^'"]+)['"]?:\s*(patch|minor|major)$/u.exec(line.trim());
    if (!entry?.[1] || !entry[2]) throw new Error(`${path} has unsupported frontmatter`);
    return { packageName: entry[1], bump: entry[2] as Bump, description };
  });
}

function parseVersion(version: string, context: string): [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) throw new Error(`${context} must use a stable semantic version`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function incrementVersion(version: string, bump: Bump): string {
  const [major, minor, patch] = parseVersion(version, version);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function highestBump(changes: Change[]): Bump {
  return changes.reduce<Bump>(
    (highest, change) => (bumpRank[change.bump] > bumpRank[highest] ? change.bump : highest),
    "patch",
  );
}

function readBase(repository: string, base: string, path: string): string | undefined {
  return git(repository, ["show", `${base}:${path}`], true);
}

function parseManifest(text: string, path: string): Manifest {
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

function packagePaths(repository: string, base: string): Map<string, string> {
  const paths = git(repository, ["ls-tree", "-r", "--name-only", base])?.split("\n") ?? [];
  const packages = new Map<string, string>();
  for (const path of paths.filter((candidate) => candidate.endsWith("/package.json"))) {
    const text = readBase(repository, base, path);
    if (!text) continue;
    const manifest = parseManifest(text, path);
    if (manifest.name && !manifest.private) packages.set(manifest.name, path);
  }
  return packages;
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function releaseEntries(text: string, packageName: string, version: string): Map<string, string[]> {
  const lines = text.trimEnd().split("\n");
  if (lines[0] !== `# ${packageName}` || lines[2] !== `## ${version}`) {
    throw new Error(`${packageName} changelog must start with release ${version}`);
  }
  const nextRelease = lines.findIndex((line, index) => index > 2 && line.startsWith("## "));
  const releaseLines = lines.slice(3, nextRelease < 0 ? undefined : nextRelease);
  return parseReleaseLines(releaseLines, packageName);
}

function parseReleaseLines(lines: string[], packageName: string): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  let category: string | undefined;
  for (const line of lines) {
    const heading = /^### (Major|Minor|Patch) Changes$/u.exec(line)?.[1]?.toLowerCase();
    if (heading) {
      category = startCategory(entries, category, heading, packageName);
    } else if (line.startsWith("- ") && category) {
      entries.get(category)?.push(line.replace(/^- (?:[0-9a-f]+: )?/u, ""));
    } else if (line.trim() && category && (entries.get(category)?.length ?? 0) > 0) {
      const values = entries.get(category) ?? [];
      values[values.length - 1] = `${values.at(-1)} ${line.trim()}`;
    } else if (line.trim()) {
      throw new Error(`${packageName} changelog has unexpected release content`);
    }
  }
  assertCategoryComplete(entries, category, packageName);
  return entries;
}

function startCategory(
  entries: Map<string, string[]>,
  current: string | undefined,
  next: string,
  packageName: string,
): string {
  if (entries.has(next))
    throw new Error(`${packageName} changelog has malformed release categories`);
  assertCategoryComplete(entries, current, packageName);
  entries.set(next, []);
  return next;
}

function assertCategoryComplete(
  entries: Map<string, string[]>,
  category: string | undefined,
  packageName: string,
): void {
  if (category && entries.get(category)?.length === 0) {
    throw new Error(`${packageName} changelog has malformed release categories`);
  }
}

function assertChangelog(
  current: string,
  previous: string | undefined,
  packageName: string,
  version: string,
  changes: Change[],
): void {
  const actual = releaseEntries(current, packageName, version);
  for (const bump of ["major", "minor", "patch"] as const) {
    const expected = changes
      .filter((change) => change.bump === bump)
      .map((change) => normalized(change.description));
    const observed = (actual.get(bump) ?? []).map(normalized);
    if (expected.sort().join("\n") !== observed.sort().join("\n")) {
      throw new Error(`${packageName} changelog does not match consumed ${bump} Changesets`);
    }
  }
  assertPreviousChangelog(current, previous, packageName);
}

function assertPreviousChangelog(
  current: string,
  previous: string | undefined,
  name: string,
): void {
  const currentHistory = current.indexOf("\n## ", current.indexOf("\n## ") + 1);
  if (!previous) {
    if (currentHistory >= 0) throw new Error(`${name} changelog contains unexpected history`);
    return;
  }
  const previousHistory = previous.indexOf("\n## ");
  if (previousHistory < 0 || currentHistory < 0)
    throw new Error(`${name} changelog lost release history`);
  if (current.slice(currentHistory).trimEnd() !== previous.slice(previousHistory).trimEnd()) {
    throw new Error(`${name} changelog modified existing release history`);
  }
}

function assertManifest(previous: Manifest, current: Manifest, path: string, bump: Bump): string {
  if (!previous.version || !current.version) throw new Error(`${path} must declare a version`);
  const expected = incrementVersion(previous.version, bump);
  if (current.version !== expected || current.version === "0.0.0") {
    throw new Error(`${path} version must advance from ${previous.version} to ${expected}`);
  }
  const withoutVersion = { ...current, version: previous.version };
  if (JSON.stringify(previous) !== JSON.stringify(withoutVersion)) {
    throw new Error(`${path} may only change its version`);
  }
  return current.version;
}

function expectedPaths(changesets: string[], packageManifests: string[]): Set<string> {
  const expected = new Set(changesets);
  for (const manifest of packageManifests) {
    expected.add(manifest);
    expected.add(`${manifest.slice(0, -"package.json".length)}CHANGELOG.md`);
  }
  return expected;
}

export function validateReleaseIntegrity(repository: string, base: string): void {
  const root = resolve(repository);
  const entries = diffEntries(root, base);
  const consumed = entries.filter(
    ({ path, status }) => status === "D" && /^\.changeset\/[^/]+\.md$/u.test(path),
  );
  if (consumed.length === 0)
    throw new Error("Generated release must consume at least one Changeset");
  const changes = consumed.flatMap(({ path }) =>
    parseChangeset(readBase(root, base, path) ?? "", path),
  );
  const packages = packagePaths(root, base);
  const affected = [...new Set(changes.map(({ packageName }) => packageName))];
  const manifests = affected.map((name) => requiredPackagePath(packages, name));
  const expected = expectedPaths(
    consumed.map(({ path }) => path),
    manifests,
  );
  const actual = new Set(entries.map(({ path }) => path));
  if (
    [...actual].some((path) => !expected.has(path)) ||
    [...expected].some((path) => !actual.has(path))
  ) {
    throw new Error("Release diff contains missing or unexpected artifacts");
  }
  for (const packageName of affected) validatePackage(root, base, packageName, packages, changes);
}

function requiredPackagePath(packages: Map<string, string>, packageName: string): string {
  const path = packages.get(packageName);
  if (!path) throw new Error(`Unknown package ${packageName}`);
  return path;
}

function validatePackage(
  repository: string,
  base: string,
  packageName: string,
  packages: Map<string, string>,
  changes: Change[],
): void {
  const path = packages.get(packageName);
  if (!path) throw new Error(`Unknown package ${packageName}`);
  const previousText = readBase(repository, base, path);
  if (!previousText) throw new Error(`Missing base manifest ${path}`);
  const currentText = readFileSync(resolve(repository, path), "utf8");
  const packageChanges = changes.filter((change) => change.packageName === packageName);
  const version = assertManifest(
    parseManifest(previousText, path),
    parseManifest(currentText, path),
    path,
    highestBump(packageChanges),
  );
  const changelogPath = `${path.slice(0, -"package.json".length)}CHANGELOG.md`;
  const currentChangelog = readFileSync(resolve(repository, changelogPath), "utf8");
  assertChangelog(
    currentChangelog,
    readBase(repository, base, changelogPath),
    packageName,
    version,
    packageChanges,
  );
}

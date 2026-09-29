import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Bump = "major" | "minor" | "patch";
type Change = { bump: Bump; description: string; packageName: string; hash: string };
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

function parseChangeset(text: string, path: string, hash: string): Change[] {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/u.exec(text.trim());
  if (!match) throw new Error(`${path} is not a valid Changeset`);
  const description = match[2]?.trim() ?? "";
  if (!description) throw new Error(`${path} has no changelog description`);
  return (match[1] ?? "").split("\n").map((line) => {
    const entry = /^['"]?([^'"]+)['"]?:\s*(patch|minor|major)$/u.exec(line.trim());
    if (!entry?.[1] || !entry[2]) throw new Error(`${path} has unsupported frontmatter`);
    return { packageName: entry[1], bump: entry[2] as Bump, description, hash };
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
      entries.get(category)?.push(line.slice(2));
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
  dependencies: Map<string, string>,
  dependencyChanges: Change[],
): void {
  const actual = releaseEntries(current, packageName, version);
  assertDependencyNotes(actual.get("patch") ?? [], packageName, dependencies, dependencyChanges);
  for (const bump of ["major", "minor", "patch"] as const) {
    const expected = changes
      .filter((change) => change.bump === bump)
      .map((change) => `${change.hash}: ${normalized(change.description)}`);
    const observed = (actual.get(bump) ?? [])
      .filter((entry) => !entry.startsWith("Updated dependencies ["))
      .map(normalized);
    if (expected.sort().join("\n") !== observed.sort().join("\n")) {
      throw new Error(`${packageName} changelog does not match consumed ${bump} Changesets`);
    }
  }
  assertPreviousChangelog(current, previous, packageName);
}

function assertDependencyNotes(
  patchEntries: string[],
  packageName: string,
  dependencies: Map<string, string>,
  dependencyChanges: Change[],
): void {
  const dependencyNotes = patchEntries.filter((entry) =>
    entry.startsWith("Updated dependencies ["),
  );
  const expectedNotes = [...new Set(dependencyChanges.map(({ hash }) => hash))].map(
    (hash) => `Updated dependencies [${hash}]`,
  );
  const dependencyList = [...dependencies].map(([name, version]) => `${name}@${version}`);
  // Changesets emits one dependency list under the last hash, not one list per hash.
  const observedNotes = dependencyNotes.map((entry, index) => {
    const match = /^Updated dependencies \[([0-9a-f]+)\](.*)$/u.exec(entry);
    if (!match) throw new Error(`${packageName} has malformed dependency notes`);
    const list = match[2]?.trim();
    if (list) {
      if (index !== dependencyNotes.length - 1) {
        throw new Error(`${packageName} has misplaced dependency versions`);
      }
      const observed = list
        .split(/(?:^|\s)-\s+/u)
        .filter(Boolean)
        .sort();
      if (observed.join("\n") !== dependencyList.sort().join("\n")) {
        throw new Error(`${packageName} changelog dependency versions do not match release graph`);
      }
    }
    return `Updated dependencies [${match[1]}]`;
  });
  if (
    observedNotes.sort().join("\n") !== expectedNotes.sort().join("\n") ||
    (dependencyList.length > 0 && !dependencyNotes.at(-1)?.includes(" - "))
  )
    throw new Error(`${packageName} changelog dependency notes do not match Changesets`);
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

function assertManifest(
  previous: Manifest,
  current: Manifest,
  path: string,
  bump: Bump,
  versions: Map<string, { previous: string; current: string }>,
): { version: string; dependencies: Map<string, string> } {
  if (!previous.version || !current.version) throw new Error(`${path} must declare a version`);
  const expected = incrementVersion(previous.version, bump);
  if (current.version !== expected || current.version === "0.0.0") {
    throw new Error(`${path} version must advance from ${previous.version} to ${expected}`);
  }
  const dependencies = new Map<string, string>();
  const allowed = { ...(previous.dependencies as Record<string, string> | undefined) };
  for (const [name, { previous: oldVersion, current: version }] of versions) {
    if (!(name in allowed)) continue;
    const prior = allowed[name];
    const proposed = `^${version}`;
    if (prior === proposed) continue;
    const actual = (current.dependencies as Record<string, string> | undefined)?.[name];
    if (prior !== `^${oldVersion}` || actual !== proposed) {
      throw new Error(`${path} dependency ${name} must match release graph ${proposed}`);
    }
    allowed[name] = proposed;
    dependencies.set(name, version);
  }
  const expectedManifest =
    previous.dependencies === undefined ? previous : { ...previous, dependencies: allowed };
  if (
    JSON.stringify(expectedManifest) !== JSON.stringify({ ...current, version: previous.version })
  ) {
    throw new Error(`${path} may only change its version and approved dependencies`);
  }
  return { version: current.version, dependencies };
}

function expectedPaths(changesets: string[], packageManifests: string[]): Set<string> {
  const expected = new Set(changesets);
  for (const manifest of packageManifests) {
    expected.add(manifest);
    expected.add(`${manifest.slice(0, -"package.json".length)}CHANGELOG.md`);
  }
  return expected;
}

function releaseGraph(
  repository: string,
  base: string,
  packages: Map<string, string>,
  changes: Change[],
) {
  const affected = [...new Set(changes.map(({ packageName }) => packageName))];
  const baseManifests = new Map<string, Manifest>();
  for (const [name, path] of packages) {
    baseManifests.set(name, parseManifest(readBase(repository, base, path) ?? "", path));
  }
  // Changesets advances dependents when their internal dependency range advances.
  for (let index = 0; index < affected.length; index++) {
    const name = affected[index];
    for (const [dependent, manifest] of baseManifests) {
      if (
        !affected.includes(dependent) &&
        Object.hasOwn((manifest.dependencies as object) ?? {}, name)
      )
        affected.push(dependent);
    }
  }
  const versions = new Map<string, { previous: string; current: string }>();
  for (const name of affected) {
    const path = requiredPackagePath(packages, name);
    const previous = baseManifests.get(name);
    if (!previous?.version) throw new Error(`${path} must declare a version`);
    versions.set(name, {
      previous: previous.version,
      current: incrementVersion(
        previous.version,
        highestBump(changes.filter((change) => change.packageName === name)),
      ),
    });
  }
  return { affected, versions };
}

export function validateReleaseIntegrity(repository: string, base: string): Map<string, string> {
  const root = resolve(repository);
  const entries = diffEntries(root, base);
  const consumed = entries.filter(
    ({ path, status }) => status === "D" && /^\.changeset\/[^/]+\.md$/u.test(path),
  );
  if (consumed.length === 0)
    throw new Error("Generated release must consume at least one Changeset");
  const changes = consumed.flatMap(({ path }) => {
    const hash = git(root, [
      "log",
      "-1",
      "--diff-filter=A",
      "--format=%h",
      base,
      "--",
      path,
    ])?.trim();
    if (!hash) throw new Error(`No source commit for ${path}`);
    return parseChangeset(readBase(root, base, path) ?? "", path, hash);
  });
  const packages = packagePaths(root, base);
  const { affected, versions } = releaseGraph(root, base, packages, changes);
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
  for (const packageName of affected)
    validatePackage(root, base, packageName, packages, changes, versions);
  return new Map([...versions].map(([name, { current }]) => [name, current]));
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
  versions: Map<string, { previous: string; current: string }>,
): void {
  const path = packages.get(packageName);
  if (!path) throw new Error(`Unknown package ${packageName}`);
  const previousText = readBase(repository, base, path);
  if (!previousText) throw new Error(`Missing base manifest ${path}`);
  const currentText = readFileSync(resolve(repository, path), "utf8");
  const packageChanges = changes.filter((change) => change.packageName === packageName);
  const previous = parseManifest(previousText, path);
  const { version, dependencies } = assertManifest(
    previous,
    parseManifest(currentText, path),
    path,
    highestBump(packageChanges),
    versions,
  );
  const changelogPath = `${path.slice(0, -"package.json".length)}CHANGELOG.md`;
  const currentChangelog = readFileSync(resolve(repository, changelogPath), "utf8");
  assertChangelog(
    currentChangelog,
    readBase(repository, base, changelogPath),
    packageName,
    version,
    packageChanges,
    dependencies,
    changes.filter((change) => dependencies.has(change.packageName)),
  );
}

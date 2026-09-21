import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseChangesetFile } from "@changesets/parse";

interface RootManifest {
  readonly workspaces?: unknown;
}

interface PackageManifest {
  readonly name?: unknown;
}

export async function copyChangesetReleaseWorkspace(
  sourceRoot: string,
  destinationRoot: string,
): Promise<readonly string[]> {
  const workspaces = await discoverWorkspaceDirectories(sourceRoot);
  await mkdir(destinationRoot, { recursive: true });
  await Promise.all([
    cp(join(sourceRoot, ".changeset"), join(destinationRoot, ".changeset"), { recursive: true }),
    cp(join(sourceRoot, "package.json"), join(destinationRoot, "package.json")),
    cp(join(sourceRoot, "bun.lock"), join(destinationRoot, "bun.lock")),
    ...workspaces.map((workspace) => copyWorkspace(sourceRoot, destinationRoot, workspace)),
  ]);
  await assertChangesetPackagesPresent(destinationRoot, workspaces);
  return Object.freeze(workspaces);
}

export async function discoverWorkspaceDirectories(root: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as RootManifest;
  if (!Array.isArray(manifest.workspaces)) throw new Error("Root workspaces must be an array");
  const directories: string[] = [];
  for (const pattern of manifest.workspaces) {
    if (typeof pattern !== "string") throw new Error("Workspace patterns must be strings");
    directories.push(...(await expandWorkspacePattern(root, pattern)));
  }
  return [...new Set(directories)].sort();
}

export async function assertChangesetPackagesPresent(
  root: string,
  workspaceDirectories: readonly string[],
): Promise<void> {
  const packageNames = new Set<string>();
  for (const directory of workspaceDirectories) {
    const manifest = await readPackageManifest(join(root, directory, "package.json"));
    if (typeof manifest.name === "string") packageNames.add(manifest.name);
  }
  for (const file of await changesetFiles(root)) {
    const text = await readFile(join(root, ".changeset", file), "utf8");
    for (const release of parseChangesetFile(text).releases) {
      if (!packageNames.has(release.name)) {
        throw new Error(
          `${file} references ${release.name}, which is missing from the smoke workspace`,
        );
      }
    }
  }
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  if (!pattern.endsWith("/*")) {
    await readPackageManifest(join(root, pattern, "package.json"));
    return [pattern];
  }
  const parent = pattern.slice(0, -2);
  const entries = await readdir(join(root, parent), { withFileTypes: true });
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(parent, entry.name);
    await readPackageManifest(join(root, directory, "package.json"));
    directories.push(directory);
  }
  return directories;
}

async function copyWorkspace(
  source: string,
  destination: string,
  workspace: string,
): Promise<void> {
  const target = join(destination, workspace);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(source, workspace), target, {
    recursive: true,
    filter: (path) => !path.includes("/node_modules/"),
  });
}

async function changesetFiles(root: string): Promise<string[]> {
  const entries = await readdir(join(root, ".changeset"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map(({ name }) => name)
    .sort();
}

async function readPackageManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

import { spawnSync } from "node:child_process";
import { cp, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyChangesetReleaseWorkspace } from "./smoke-release-workspace.js";

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers");
const names = ["provider-routing", "core", "syntax", "host", "language-service"];
const bare = ["provider-routing"];

function numericVersion(version: string): bigint[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw Error(`Invalid numeric release version: ${version}`);
  return version.split(".").map(BigInt);
}

function assertPlannedRouter(
  source: { name: string; version: string },
  planned: { name: string; version: string },
): void {
  if (source.name !== "@kalada/provider-routing" || planned.name !== source.name)
    throw Error(`Unexpected router package: ${source.name} -> ${planned.name}`);
  const from = numericVersion(source.version);
  const to = numericVersion(planned.version);
  for (let index = 0; index < from.length; index++) {
    if (to[index] > from[index]) return;
    if (to[index] < from[index]) break;
  }
  throw Error(`Router release plan did not advance: ${source.version} -> ${planned.version}`);
}

function run(args: string[], cwd: string): string {
  const [command, ...rest] = args;
  if (!command) throw Error("Missing command");
  const result = spawnSync(command, rest, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_registry: "http://127.0.0.1:9" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

async function manifest(
  path: string,
): Promise<{ name: string; version: string; dependencies?: Record<string, string> }> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function pack(directory: string, source: string): Promise<string> {
  const [{ filename, files }] = JSON.parse(
    run(["npm", "pack", "--json", source, "--pack-destination", directory], root),
  );
  for (const path of [
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
    "package.json",
  ]) {
    if (!files.some((file: { path: string }) => file.path === path))
      throw Error(`${source}: missing ${path}`);
  }
  if (
    files.some(
      (file: { path: string }) => file.path.includes("src/") || file.path.includes(".test."),
    )
  )
    throw Error("Source included in pack");
  return join(directory, filename);
}

function archivePath(consumer: string, specifier: unknown, archives: string[]): string {
  if (typeof specifier !== "string" || !specifier.startsWith("file:"))
    throw Error(`Non-local resolution: ${specifier}`);
  const path = resolve(consumer, specifier.slice(5));
  if (!archives.includes(path)) throw Error(`Not a packed archive: ${specifier}`);
  return path;
}

async function physicalPackages(consumer: string): Promise<string[]> {
  const installed: string[] = [];
  function isPackage(directory: string, name: string): boolean {
    if (directory.endsWith("node_modules")) return !name.startsWith("@") && !name.startsWith(".");
    return (
      directory.split("/").at(-2) === "node_modules" &&
      directory.split("/").at(-1)?.startsWith("@") === true
    );
  }
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relative = path.slice(consumer.length + 1);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw Error(`Installed symlink: ${relative}`);
      if (!stat.isDirectory()) continue;
      // Scoped package containers and npm's own dot entries are not packages.
      if (isPackage(directory, entry.name)) installed.push(relative);
      await walk(path);
    }
  }
  await walk(join(consumer, "node_modules"));
  return installed.sort();
}

type GraphNode = { version?: string; resolved?: string; dependencies?: Record<string, GraphNode> };

function checkGraph(
  consumer: string,
  dependencies: Record<string, GraphNode> | undefined,
  expected: string[],
  manifests: Map<string, { name: string; version: string; dependencies?: Record<string, string> }>,
  archives: string[],
  depth = 0,
): void {
  // npm ls abbreviates repeated transitive nodes to { version } without repeating their edges.
  if (depth > 1 && dependencies === undefined && expected.length > 0) return;
  if (
    (depth <= 1 || dependencies !== undefined || expected.length === 0) &&
    JSON.stringify(Object.keys(dependencies ?? {}).sort()) !== JSON.stringify(expected.sort())
  )
    throw Error(`npm ls dependency graph mismatch: ${JSON.stringify(dependencies)}`);
  for (const name of expected) {
    const node = dependencies?.[name];
    const packed = manifests.get(name);
    if (!node || !packed || node.version !== packed.version)
      throw Error(`npm ls version mismatch: ${name}`);
    if (depth === 0 || node.resolved !== undefined) archivePath(consumer, node.resolved, archives);
    checkGraph(
      consumer,
      node.dependencies,
      Object.keys(packed.dependencies ?? {}),
      manifests,
      archives,
      depth + 1,
    );
  }
}

async function assertInstall(
  consumer: string,
  archives: string[],
  expected: string[],
  routerVersion: string,
): Promise<void> {
  const lock = JSON.parse(await readFile(join(consumer, "package-lock.json"), "utf8"));
  const graph = JSON.parse(run(["npm", "ls", "--all", "--json"], consumer));
  const installed = Object.keys(lock.packages).filter((key) => key.startsWith("node_modules/"));
  const wanted = expected.map((name) => `node_modules/@kalada/${name}`).sort();
  if (JSON.stringify(installed.sort()) !== JSON.stringify(wanted))
    throw Error(`Unexpected graph: ${installed}`);
  const physical = await physicalPackages(consumer);
  if (JSON.stringify(physical) !== JSON.stringify(wanted))
    throw Error(`Unexpected physical packages: ${physical}`);
  const manifests = new Map<string, Awaited<ReturnType<typeof manifest>>>();
  for (const name of expected) {
    const key = `node_modules/@kalada/${name}`;
    const entry = lock.packages[key];
    if (!entry.integrity || entry.link)
      throw Error(`${key} did not resolve to a packed local artifact: ${JSON.stringify(entry)}`);
    const resolved = archivePath(consumer, entry.resolved, archives);
    const installedManifest = await manifest(join(consumer, key, "package.json"));
    if (installedManifest.version !== entry.version || installedManifest.name !== `@kalada/${name}`)
      throw Error(`${key} manifest mismatch`);
    if (
      name === "provider-routing" &&
      (resolved !== archives[0] || entry.version !== routerVersion)
    )
      throw Error("Installed router does not match planned archive and version");
    manifests.set(installedManifest.name, installedManifest);
  }
  checkGraph(
    consumer,
    graph.dependencies,
    expected.map((name) => `@kalada/${name}`),
    manifests,
    archives,
  );
  console.log(
    `Installed graph: ${JSON.stringify(graph.dependencies)}; lock: ${JSON.stringify(Object.fromEntries(wanted.map((key) => [key, lock.packages[key].resolved])))}`,
  );
}

function runTypes(consumer: string): void {
  for (const file of ["types.mts", "types.cts"])
    run(
      [
        resolve(root, "node_modules/.bin/tsc"),
        "--strict",
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        file,
      ],
      consumer,
    );
}

async function browserSmoke(consumer: string, selected: string[], optin: boolean): Promise<void> {
  run(
    [
      "bun",
      "build",
      "browser.mjs",
      "--target=browser",
      "--format=iife",
      "--metafile=browser-meta.json",
      "--outfile=browser.js",
    ],
    consumer,
  );
  const meta = JSON.parse(await readFile(join(consumer, "browser-meta.json"), "utf8"));
  const inputs = Object.keys(meta.inputs ?? {});
  console.log(`Browser bundle inputs: ${JSON.stringify(inputs)}`);
  const forbidden = optin
    ? []
    : ["@kalada/host", "@kalada/syntax", "@kalada/language-service", "@kalada/core"];
  if (
    !inputs.includes("browser.mjs") ||
    !inputs.includes("node_modules/@kalada/provider-routing/dist/index.js") ||
    inputs.some((path) => forbidden.some((name) => path.includes(name)))
  )
    throw Error(`Browser bundle pulled in forbidden packages: ${inputs}`);
  if (
    inputs.some(
      (path) =>
        !["browser.mjs", "domain.mjs"].includes(path) &&
        !selected.some((name) => path.startsWith(`node_modules/@kalada/${name}/dist/`)),
    )
  )
    throw Error(`Browser bundle used workspace source: ${inputs}`);
  if (
    Object.values(meta.outputs ?? {}).some(
      (output) => (output as { imports?: unknown[] }).imports?.length,
    )
  )
    throw Error("Browser bundle contains external imports");
  run(["node", "browser-runner.cjs"], consumer);
}

async function consume(
  directory: string,
  archives: string[],
  selected: string[],
  optin: boolean,
  routerVersion: string,
): Promise<void> {
  const consumer = join(directory, optin ? "optin" : "domain-only");
  await cp(join(fixtures, optin ? "provider-routing-optin" : "provider-routing"), consumer, {
    recursive: true,
  });
  if (optin) await cp(join(fixtures, "provider-routing/domain.mjs"), join(consumer, "domain.mjs"));
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    [
      "npm",
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(directory, "empty-cache"),
      ...archives,
    ],
    consumer,
  );
  await assertInstall(consumer, archives, selected, routerVersion);
  run(["node", "esm.mjs"], consumer);
  run(["node", "cjs.cjs"], consumer);
  runTypes(consumer);
  await browserSmoke(consumer, selected, optin);
  console.log(`Packed ${optin ? "opt-in" : "domain-only"} browser/node consumers passed`);
}

async function release(directory: string): Promise<string> {
  const location = join(directory, "release");
  await copyChangesetReleaseWorkspace(root, location);
  run([resolve(root, "node_modules/.bin/changeset"), "version"], location);
  return location;
}

async function packPlannedRouter(
  directory: string,
  location: string,
): Promise<{ archive: string; version: string }> {
  const source = await manifest(join(root, "packages/provider-routing/package.json"));
  const planned = await manifest(join(location, "packages/provider-routing/package.json"));
  assertPlannedRouter(source, planned);
  const router = await pack(directory, join(location, "packages/provider-routing"));
  const packed = JSON.parse(run(["tar", "-xOf", router, "package/package.json"], root));
  if (packed.name !== planned.name || packed.version !== planned.version)
    throw Error("Router archive does not match release plan");
  if (packed.dependencies || packed.peerDependencies || packed.optionalDependencies)
    throw Error("Router is not neutral");
  console.log(`Domain-only router: ${packed.version}, no dependencies`);
  return { archive: router, version: planned.version };
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-packed-router-"));
  try {
    const location = await release(directory);
    const { archive: router, version: routerVersion } = await packPlannedRouter(
      directory,
      location,
    );
    await consume(directory, [router], bare, false, routerVersion);
    const archives = await Promise.all(
      names.map((name) =>
        name === "provider-routing"
          ? Promise.resolve(router)
          : pack(directory, join(location, "packages", name)),
      ),
    );
    const versions = new Map<string, string>();
    for (const [index, archive] of archives.entries()) {
      const packed = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
      versions.set(packed.name, packed.version);
      if (packed.name !== `@kalada/${names[index]}`) throw Error("Wrong packed package");
      console.log(`${packed.name}@${packed.version}: ${JSON.stringify(packed.dependencies ?? {})}`);
    }
    for (const archive of archives) {
      const packed = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
      for (const [name, range] of Object.entries(packed.dependencies ?? {})) {
        const version = versions.get(name);
        if (!version || range !== `^${version}`)
          throw Error(`${packed.name} requires ${name}@${range}, not local ${version}`);
      }
    }
    await consume(directory, archives, names, true, routerVersion);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

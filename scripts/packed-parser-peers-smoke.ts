import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyChangesetReleaseWorkspace } from "./smoke-release-workspace.js";

const root = resolve(import.meta.dirname, "..");
const fixtures = join(root, "tests/consumers/parser-peers");
const names = ["provider-routing", "core", "syntax"] as const;

function run(args: string[], cwd: string): string {
  const [bin, ...rest] = args;
  if (!bin) throw Error("Missing executable");
  const result = spawnSync(bin, rest, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_offline: "true" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

async function pack(directory: string): Promise<Record<string, string>> {
  const release = join(directory, "release");
  await copyChangesetReleaseWorkspace(root, release);
  run([join(root, "node_modules/.bin/changeset"), "version"], release);
  const archives: Record<string, string> = {};
  for (const name of names) {
    const packageDir = join(release, `packages/${name}`);
    const planned = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    const [packed] = JSON.parse(
      run(["npm", "pack", "--json", packageDir, "--pack-destination", directory], root),
    );
    if (!packed || packed.version !== planned.version || packed.version === "0.0.0")
      throw Error(`Unaligned ${name} pack`);
    const archive = join(directory, packed.filename);
    const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
    if (manifest.version !== planned.version || manifest.name !== `@kalada/${name}`)
      throw Error(`Invalid ${name} manifest`);
    if (
      name === "provider-routing" &&
      (manifest.dependencies || manifest.peerDependencies || manifest.optionalDependencies)
    ) {
      throw Error("Neutral router acquired dependencies");
    }
    if (
      name === "syntax" &&
      manifest.dependencies?.["@kalada/core"] !==
        `^${JSON.parse(await readFile(join(release, "packages/core/package.json"), "utf8")).version}`
    ) {
      throw Error("Syntax/core release lines do not align");
    }
    archives[name] = archive;
    console.log(
      `${name}: ${manifest.version} ${packed.filename} dependencies=${JSON.stringify(manifest.dependencies ?? {})}`,
    );
  }
  return archives;
}

async function physicalPackages(directory: string): Promise<string[]> {
  const found: string[] = [];
  await visitModules(join(directory, "node_modules"), found);
  return found.sort();
}

async function physicalDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error(`Nonphysical install: ${path}`);
}

async function visitModules(modules: string, found: string[]): Promise<void> {
  await physicalDirectory(modules);
  for (const entry of await readdir(modules)) {
    if (entry === ".package-lock.json") continue;
    const scope = join(modules, entry);
    await physicalDirectory(scope);
    if (!entry.startsWith("@")) throw Error(`Unexpected unscoped package: ${scope}`);
    for (const scoped of await readdir(scope)) {
      const child = join(scope, scoped);
      await physicalDirectory(child);
      found.push(child);
      try {
        await visitModules(join(child, "node_modules"), found);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

async function installedGraph(
  directory: string,
  expected: string[],
  archives: Record<string, string>,
): Promise<void> {
  const installed = JSON.parse(run(["npm", "ls", "--all", "--json", "--offline"], directory));
  const actual = Object.keys(installed.dependencies ?? {}).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected.map((name) => `@kalada/${name}`).sort())) {
    throw Error(`Unexpected dependency graph: ${JSON.stringify(actual)}`);
  }
  const lock = JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8"));
  const rootDependencies = Object.keys(lock.packages[""].dependencies ?? {}).sort();
  if (JSON.stringify(rootDependencies) !== JSON.stringify(actual))
    throw Error(`Unexpected lock root dependencies: ${rootDependencies}`);
  const lockNames = Object.keys(lock.packages)
    .filter((path) => path.startsWith("node_modules/"))
    .sort();
  if (
    JSON.stringify(lockNames) !==
    JSON.stringify(expected.map((name) => `node_modules/@kalada/${name}`).sort())
  ) {
    throw Error(`Unexpected lock graph: ${lockNames}`);
  }
  const physical = await physicalPackages(directory);
  const paths = expected.map((name) => join(directory, `node_modules/@kalada/${name}`)).sort();
  if (JSON.stringify(physical) !== JSON.stringify(paths)) {
    throw Error(`Unexpected recursive physical graph: ${physical}`);
  }
  for (const name of expected) {
    checkGraphNode(name, installed.dependencies[`@kalada/${name}`], lock);
    await installedPackage(directory, name, lock, archives[name]);
  }
  console.log(`graph: ${actual.join(", ")}; lock integrities and physical paths checked`);
}

function checkGraphNode(
  name: string,
  graphNode: { version: string; dependencies?: Record<string, { version: string }> } | undefined,
  lock: { packages: Record<string, { version: string }> },
): void {
  const descendants = Object.keys(graphNode?.dependencies ?? {});
  if (
    !graphNode ||
    JSON.stringify(descendants.sort()) !==
      JSON.stringify(name === "syntax" ? ["@kalada/core"] : []) ||
    (name === "syntax" &&
      graphNode.dependencies?.["@kalada/core"].version !==
        lock.packages["node_modules/@kalada/core"].version)
  )
    throw Error(`Unexpected npm ls descendants: ${name}`);
  if (graphNode.version !== lock.packages[`node_modules/@kalada/${name}`].version)
    throw Error(`npm ls version mismatch: ${name}`);
}

async function installedPackage(
  directory: string,
  name: string,
  lock: {
    packages: Record<
      string,
      { link?: boolean; integrity?: string; resolved?: string; version: string }
    >;
  },
  archive: string,
): Promise<void> {
  const path = join(directory, `node_modules/@kalada/${name}`);
  const entry = lock.packages[`node_modules/@kalada/${name}`];
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`;
  if (
    entry.link ||
    entry.integrity !== integrity ||
    !entry.resolved?.startsWith("file:") ||
    resolve(directory, entry.resolved.slice(5)) !== archive
  ) {
    throw Error(`Tarball source/integrity mismatch for ${name}`);
  }
  const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  if (manifest.version !== entry.version) throw Error(`Lock/installed version mismatch: ${name}`);
  if (name === "provider-routing") {
    const files = await readdir(join(path, "dist"));
    for (const file of files.filter((entry) => /\.js$|\.cjs$/u.test(entry))) {
      const source = await readFile(join(path, "dist", file), "utf8");
      if (/@kalada\/(syntax|core|host|language-service|codemirror)|Expressions/u.test(source)) {
        throw Error(`Neutral runtime imports language code: ${file}`);
      }
    }
  }
}

async function consumer(
  directory: string,
  archives: Record<string, string>,
  names: string[],
): Promise<void> {
  await cp(fixtures, directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "packed-peers-smoke", private: true, type: "module" }),
  );
  run(
    [
      "npm",
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...names.map((name) => archives[name] ?? ""),
    ],
    directory,
  );
  await installedGraph(directory, names, archives);
  run(["node", "domain.mjs"], directory);
  const domainOnly = names.length === 1;
  run(["node", domainOnly ? "domain.cjs" : "cjs.cjs"], directory);
  if (!domainOnly) run(["node", "optin.mjs"], directory);
  checkConsumerTypes(directory, domainOnly);
  await checkConsumerBrowser(directory, domainOnly);
  console.log(
    `${domainOnly ? "domain" : "opt-in"} ESM/CJS, strict NodeNext, browser-target VM packed peers passed`,
  );
}

function checkConsumerTypes(directory: string, domainOnly: boolean): void {
  for (const file of domainOnly
    ? ["domain-types.mts", "domain-types.cts"]
    : ["types.mts", "types.cts"]) {
    run(
      [
        join(root, "node_modules/.bin/tsc"),
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
      directory,
    );
  }
}

async function checkConsumerBrowser(directory: string, domainOnly: boolean): Promise<void> {
  run(
    [
      "bun",
      "build",
      domainOnly ? "domain-browser.mjs" : "browser.mjs",
      "--target=browser",
      "--format=iife",
      "--reject-unresolved",
      "--metafile=browser-meta.json",
      "--outfile=browser.js",
    ],
    directory,
  );
  await browserGraph(directory, domainOnly);
  run(["node", "browser-runner.cjs"], directory);
}

async function browserGraph(directory: string, domainOnly: boolean): Promise<void> {
  const bundle = await readFile(join(directory, "browser.js"), "utf8");
  if (
    /\b(?:process|Buffer|require)\b|["']node:|@kalada\/host|Expressions|\bimport\s*\(/u.test(bundle)
  )
    throw Error("Browser bundle contains forbidden dependency");
  const meta = JSON.parse(await readFile(join(directory, "browser-meta.json"), "utf8"));
  const inputs = Object.keys(meta.inputs ?? {});
  if (!inputs.length || Object.keys(meta.outputs ?? {}).length !== 1)
    throw Error("Unexpected browser output graph");
  const expected = domainOnly
    ? ["domain-browser.mjs", "peers.mjs", "node_modules/@kalada/provider-routing/dist/index.js"]
    : [
        "browser.mjs",
        "peers.mjs",
        "node_modules/@kalada/provider-routing/dist/index.js",
        "node_modules/@kalada/syntax/dist/index.js",
      ];
  if (JSON.stringify(inputs.sort()) !== JSON.stringify(expected.sort()))
    throw Error(`Unexpected browser inputs: ${inputs}`);
  for (const input of inputs) validateBrowserInput(input, meta.inputs[input], domainOnly);
  console.log(`browser ${domainOnly ? "domain-only" : "opt-in"} inputs: ${inputs.join(", ")}`);
}

function validateBrowserInput(
  input: string,
  meta: { imports?: { external?: boolean; kind: string; path: string }[] },
  domainOnly: boolean,
): void {
  if (/node:|@kalada\/(host|language-service|codemirror)|Expressions/u.test(input))
    throw Error(`Forbidden browser input: ${input}`);
  if (domainOnly && /@kalada\/(syntax|core)/u.test(input))
    throw Error(`Domain-only graph includes language package: ${input}`);
  for (const dependency of meta.imports ?? []) {
    if (dependency.external || /dynamic|require/u.test(dependency.kind))
      throw Error(`External/dynamic browser path: ${input} -> ${dependency.path}`);
  }
}

const directory = await mkdtemp(join(tmpdir(), "kalada-packed-parser-peers-"));
try {
  const archives = await pack(directory);
  await consumer(join(directory, "domain"), archives, ["provider-routing"]);
  await consumer(join(directory, "optin"), archives, [...names]);
} finally {
  await rm(directory, { recursive: true, force: true });
}

import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface PackResult {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers/adapter-scheman");

function run(command: string[], cwd: string): string {
  const [executable, ...args] = command;
  if (!executable) throw new Error("A command is required");
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function pack(directory: string, packageName: string): PackResult {
  const output = run(
    ["npm", "pack", "--json", "--workspace", packageName, "--pack-destination", directory],
    root,
  );
  const [result] = JSON.parse(output) as PackResult[];
  if (!result) throw new Error(`npm pack returned no artifact for ${packageName}`);
  return result;
}

function assertPackage(result: PackResult, archive: string): void {
  const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
  if (manifest.name !== "@kalada/adapter-scheman" || manifest.sideEffects !== false) {
    throw new Error("Packed adapter identity metadata drifted");
  }
  if (manifest.dependencies?.["@scheman/core"] !== "^2.0.0") {
    throw new Error("Packed adapter does not pin the Scheman v2 range");
  }
  if (JSON.stringify(manifest).toLowerCase().includes('"zod"')) {
    throw new Error("Packed adapter manifest contains Zod");
  }
  const paths = result.files.map(({ path }) => path);
  for (const path of ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.d.cts"]) {
    if (!paths.includes(path)) throw new Error(`Packed adapter is missing ${path}`);
  }
}

async function installConsumer(directory: string, archives: readonly string[]): Promise<void> {
  await cp(fixtures, directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "adapter-scheman-smoke", private: true, type: "module" }),
  );
  run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], directory);
}

function runTypes(directory: string): void {
  for (const file of ["types.mts", "types.cts"]) {
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
      directory,
    );
  }
}

async function browserEvidence(directory: string): Promise<string> {
  run(
    [
      "bun",
      "build",
      "browser.mjs",
      "--target=browser",
      "--outfile=browser.js",
      "--metafile=adapter-meta.json",
    ],
    directory,
  );
  run(
    [
      "bun",
      "build",
      "host-browser.mjs",
      "--target=browser",
      "--outfile=host-browser.js",
      "--metafile=host-meta.json",
    ],
    directory,
  );
  await assertMetafile(join(directory, "adapter-meta.json"), false);
  await assertMetafile(join(directory, "host-meta.json"), true);
  await runChromium(directory, "index.html");
  await runChromium(directory, "host.html");
  return run(["chromium", "--version"], directory).trim();
}

async function assertMetafile(path: string, hostOnly: boolean): Promise<void> {
  const metadata = JSON.parse(await readFile(path, "utf8")) as { inputs: Record<string, unknown> };
  const inputs = Object.keys(metadata.inputs).join("\n");
  if (/(^|[/\\])zod([/\\]|$)/iu.test(inputs)) throw new Error("Browser bundle contains Zod");
  if (hostOnly && /@scheman[/\\]core/iu.test(inputs)) {
    throw new Error("Host-only browser bundle contains Scheman");
  }
}

async function runChromium(directory: string, page: string): Promise<void> {
  const output = run(
    [
      "chromium",
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--allow-file-access-from-files",
      "--virtual-time-budget=3000",
      "--dump-dom",
      `file://${join(directory, page)}`,
    ],
    directory,
  );
  if (!output.includes('data-kalada="passed"')) {
    throw new Error(`${page} did not execute in Chromium: ${output}`);
  }
}

function assertDependencyTree(directory: string): void {
  const tree = run(["npm", "ls", "@scheman/core", "--all", "--json"], directory);
  if (!tree.includes('"@scheman/core"')) throw new Error("Installed adapter tree omits Scheman");
  const zod = spawnSync(
    "node",
    ["-e", "try{require.resolve('zod/package.json');process.exit(1)}catch{process.exit(0)}"],
    { cwd: directory },
  );
  if (zod.status !== 0) throw new Error("Installed adapter dependency tree contains Zod");
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-adapter-scheman-smoke-"));
  try {
    const packages = ["@kalada/core", "@kalada/syntax", "@kalada/host", "@kalada/adapter-scheman"];
    const packed = packages.map((name) => pack(directory, name));
    const archives = packed.map((result) => join(directory, result.filename));
    const adapter = packed.at(-1);
    const adapterArchive = archives.at(-1);
    if (!adapter || !adapterArchive) throw new Error("Adapter pack artifact is missing");
    assertPackage(adapter, adapterArchive);
    const consumer = join(directory, "consumer");
    await installConsumer(consumer, archives);
    assertDependencyTree(consumer);
    run(["node", "esm.mjs"], consumer);
    run(["node", "cjs.cjs"], consumer);
    runTypes(consumer);
    const browser = await browserEvidence(consumer);
    console.log(`Packed adapter smoke passed: ${basename(adapterArchive)}; ${browser}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

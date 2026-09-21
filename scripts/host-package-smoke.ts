import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface PackResult {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers/host");
const browserOnly = process.argv.includes("--browser-only");
const forbiddenVendor = /@scheman\/core|(?:^|[\W_])zod(?:$|[\W_])/iu;

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

function assertManifest(archive: string): void {
  const text = run(["tar", "-xOf", archive, "package/package.json"], root);
  const manifest = JSON.parse(text);
  if (manifest.name !== "@kalada/host" || manifest.sideEffects !== false) {
    throw new Error("Packed host identity metadata drifted");
  }
  const dependencyText = JSON.stringify({
    dependencies: manifest.dependencies,
    optionalDependencies: manifest.optionalDependencies,
    peerDependencies: manifest.peerDependencies,
  });
  if (forbiddenVendor.test(dependencyText)) throw new Error("Host manifest contains a vendor path");
  if (JSON.stringify(Object.keys(manifest.exports)) !== JSON.stringify([".", "./package.json"])) {
    throw new Error("Packed host exports unintended entry points");
  }
}

function assertFiles(result: PackResult): void {
  const paths = result.files.map(({ path }) => path);
  for (const required of [
    "README.md",
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
    "package.json",
  ]) {
    if (!paths.includes(required)) throw new Error(`Packed host is missing ${required}`);
  }
  if (paths.some((path) => path.includes("src/") || path.includes(".test."))) {
    throw new Error("Packed host includes source or tests");
  }
}

function assertRuntime(archive: string): void {
  for (const file of ["dist/index.js", "dist/index.cjs"]) {
    const text = run(["tar", "-xOf", archive, `package/${file}`], root);
    if (forbiddenVendor.test(text)) throw new Error(`${file} contains a vendor load path`);
    for (const pattern of [/['"]node:/u, /\bprocess\s*\./u, /\bBuffer\b/u, /\beval\s*\(/u]) {
      if (pattern.test(text)) throw new Error(`${file} contains a forbidden runtime hook`);
    }
  }
}

async function createConsumer(directory: string): Promise<void> {
  await cp(fixtures, directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "host-smoke", private: true, type: "module" }),
  );
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

async function runBrowser(directory: string): Promise<void> {
  run(["bun", "build", "browser.mjs", "--target=browser", "--outfile=browser.js"], directory);
  const bundle = await readFile(join(directory, "browser.js"), "utf8");
  if (forbiddenVendor.test(bundle)) throw new Error("Browser bundle contains a vendor load path");
  for (const pattern of [/['"]node:/u, /\bprocess\s*\./u, /\bBuffer\b/u, /\brequire\s*\(/u]) {
    if (pattern.test(bundle)) throw new Error("Browser bundle contains a Node runtime hook");
  }
  run(["node", "browser.js"], directory);
}

function assertVendorsAbsent(directory: string): void {
  for (const vendor of ["@scheman/core", "zod"]) {
    const result = spawnSync("npm", ["ls", vendor, "--all", "--json"], {
      cwd: directory,
      encoding: "utf8",
    });
    const tree = JSON.parse(result.stdout || "{}") as { dependencies?: Record<string, unknown> };
    if (result.status === 0 || tree.dependencies?.[vendor]) {
      throw new Error(`Unexpected installed vendor: ${vendor}`);
    }
  }
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-host-smoke-"));
  try {
    const core = pack(directory, "@kalada/core");
    const syntax = pack(directory, "@kalada/syntax");
    const host = pack(directory, "@kalada/host");
    const archive = join(directory, host.filename);
    assertManifest(archive);
    assertFiles(host);
    assertRuntime(archive);
    const consumer = join(directory, "consumer");
    await createConsumer(consumer);
    run(
      [
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(directory, core.filename),
        join(directory, syntax.filename),
        archive,
      ],
      consumer,
    );
    assertVendorsAbsent(consumer);
    if (browserOnly) await runBrowser(consumer);
    else {
      run(["node", "esm.mjs"], consumer);
      run(["node", "cjs.cjs"], consumer);
      runTypes(consumer);
    }
    console.log(`Packed host smoke passed: ${basename(archive)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

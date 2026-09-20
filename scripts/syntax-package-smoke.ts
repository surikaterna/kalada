import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface PackResult {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers/syntax");
const browserOnly = process.argv.includes("--browser-only");

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

async function createReleasePlan(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await mkdir(join(directory, "packages"));
  await Promise.all([
    cp(join(root, ".changeset"), join(directory, ".changeset"), { recursive: true }),
    copyFile(join(root, "package.json"), join(directory, "package.json")),
    copyFile(join(root, "bun.lock"), join(directory, "bun.lock")),
    ...["core", "projection", "syntax"].map((name) =>
      cp(join(root, "packages", name), join(directory, "packages", name), {
        recursive: true,
        filter: (path) => !path.includes("/node_modules/"),
      }),
    ),
  ]);
  run([resolve(root, "node_modules/.bin/changeset"), "version"], directory);
  const syntax = JSON.parse(
    await readFile(join(directory, "packages/syntax/package.json"), "utf8"),
  );
  const core = JSON.parse(await readFile(join(directory, "packages/core/package.json"), "utf8"));
  if (syntax.version !== "0.1.0" || core.version !== "0.6.0") {
    throw new Error(`Unexpected release versions: syntax ${syntax.version}, core ${core.version}`);
  }
  if (syntax.dependencies?.["@kalada/core"] !== "^0.6.0") {
    throw new Error("Changesets did not rewrite syntax to the core 0.6 release line");
  }
}

function pack(directory: string, packageDirectory: string): PackResult {
  const output = run(
    ["npm", "pack", "--json", packageDirectory, "--pack-destination", directory],
    root,
  );
  const [result] = JSON.parse(output) as PackResult[];
  if (!result) throw new Error(`npm pack returned no artifact for ${packageDirectory}`);
  return result;
}

function assertManifest(archive: string): void {
  const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
  if (
    manifest.name !== "@kalada/syntax" ||
    manifest.version !== "0.1.0" ||
    manifest.sideEffects !== false
  ) {
    throw new Error("Packed syntax identity metadata drifted");
  }
  if (JSON.stringify(Object.keys(manifest.exports)) !== JSON.stringify([".", "./package.json"])) {
    throw new Error("Packed syntax exports unintended entry points");
  }
  if (JSON.stringify(manifest.dependencies) !== JSON.stringify({ "@kalada/core": "^0.6.0" })) {
    throw new Error("Packed syntax dependency does not target core 0.6");
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
    if (!paths.includes(required)) throw new Error(`Packed syntax is missing ${required}`);
  }
  if (paths.some((path) => path.includes("src/") || path.includes(".test."))) {
    throw new Error("Packed syntax includes source or tests");
  }
}

function assertRuntime(archive: string): void {
  for (const file of ["dist/index.js", "dist/index.cjs"]) {
    const text = run(["tar", "-xOf", archive, `package/${file}`], root);
    for (const pattern of [
      /["']node:/u,
      /\bprocess\s*\./u,
      /\bBuffer\b/u,
      /\beval\s*\(/u,
      /\bFunction\s*\(/u,
    ]) {
      if (pattern.test(text)) throw new Error(`${file} contains a forbidden runtime hook`);
    }
  }
}

async function createConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "syntax-smoke", private: true, type: "module" }),
  );
  for (const file of [
    "esm.mjs",
    "cjs.cjs",
    "types.mts",
    "types.cts",
    "browser.mjs",
    "browser-runner.cjs",
  ]) {
    await copyFile(join(fixtures, file), join(directory, file));
  }
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
  for (const pattern of [
    /["']node:/u,
    /\bprocess\s*\./u,
    /\bBuffer\b/u,
    /\brequire\s*\(/u,
    /\bmodule\s*\./u,
  ]) {
    if (pattern.test(bundle)) throw new Error("Browser bundle contains a Node runtime hook");
  }
  run(["node", "browser-runner.cjs"], directory);
}

function assertSingleCore(directory: string): void {
  const output = run(["npm", "ls", "@kalada/core", "--all", "--parseable"], directory);
  const installs = output
    .trim()
    .split("\n")
    .filter((path) => path.endsWith("node_modules/@kalada/core"));
  if (installs.length !== 1)
    throw new Error(`Expected one core installation, received ${installs.length}`);
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-syntax-smoke-"));
  try {
    const release = join(directory, "release");
    await createReleasePlan(release);
    const core = pack(directory, join(release, "packages/core"));
    const syntax = pack(directory, join(release, "packages/syntax"));
    const syntaxArchive = join(directory, syntax.filename);
    assertManifest(syntaxArchive);
    assertFiles(syntax);
    assertRuntime(syntaxArchive);
    const consumer = join(directory, "consumer");
    await cp(fixtures, consumer, { recursive: true });
    await createConsumer(consumer);
    run(
      [
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(directory, core.filename),
        syntaxArchive,
      ],
      consumer,
    );
    assertSingleCore(consumer);
    if (browserOnly) await runBrowser(consumer);
    else {
      run(["node", "esm.mjs"], consumer);
      run(["node", "cjs.cjs"], consumer);
      runTypes(consumer);
    }
    console.log(`Packed syntax smoke passed: ${basename(syntaxArchive)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

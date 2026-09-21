import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { copyChangesetReleaseWorkspace } from "./smoke-release-workspace.js";

interface PackResult {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers/language-service");
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
  await copyChangesetReleaseWorkspace(root, directory);
  run([resolve(root, "node_modules/.bin/changeset"), "version"], directory);
  const manifest = JSON.parse(
    await readFile(join(directory, "packages/language-service/package.json"), "utf8"),
  );
  if (manifest.version !== "0.1.0") throw new Error("Unexpected language-service release version");
  const expected = {
    "@kalada/core": "^0.6.0",
    "@kalada/host": "^0.1.0",
    "@kalada/syntax": "^0.1.0",
  };
  if (JSON.stringify(manifest.dependencies) !== JSON.stringify(expected)) {
    throw new Error("Changesets did not rewrite language-service dependency release lines");
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

function assertPackage(result: PackResult, archive: string): void {
  const paths = result.files.map(({ path }) => path);
  for (const required of [
    "README.md",
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
    "package.json",
  ]) {
    if (!paths.includes(required))
      throw new Error(`Packed language service is missing ${required}`);
  }
  if (paths.some((path) => path.includes("src/") || path.includes(".test."))) {
    throw new Error("Packed language service includes source or tests");
  }
  const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
  if (manifest.name !== "@kalada/language-service" || manifest.sideEffects !== false) {
    throw new Error("Packed language-service metadata drifted");
  }
}

function assertHeadless(text: string, source: string): void {
  const forbidden = [
    /["']node:/u,
    /\bprocess\s*\./u,
    /\bBuffer\b/u,
    /\b(?:CodeMirror|vscode|JSON-RPC|LanguageClient)\b/iu,
    /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u,
    /\beval\s*\(/u,
    /\bFunction\s*\(/u,
    /\.evaluate\s*\(/u,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`${source} contains forbidden hook ${pattern.source}`);
  }
}

function assertRuntime(archive: string): void {
  for (const file of ["dist/index.js", "dist/index.cjs"]) {
    assertHeadless(run(["tar", "-xOf", archive, `package/${file}`], root), file);
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
  assertHeadless(await readFile(join(directory, "browser.js"), "utf8"), "browser bundle");
  run(["node", "browser-runner.cjs"], directory);
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-language-service-smoke-"));
  try {
    const release = join(directory, "release");
    await createReleasePlan(release);
    const packages = ["core", "syntax", "host", "language-service"].map((name) =>
      pack(directory, join(release, "packages", name)),
    );
    const archive = join(directory, (packages[3] as PackResult).filename);
    assertPackage(packages[3] as PackResult, archive);
    assertRuntime(archive);
    const consumer = join(directory, "consumer");
    await cp(fixtures, consumer, { recursive: true });
    run(
      [
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...packages.map(({ filename }) => join(directory, filename)),
      ],
      consumer,
    );
    if (browserOnly) await runBrowser(consumer);
    else {
      run(["node", "esm.mjs"], consumer);
      run(["node", "cjs.cjs"], consumer);
      runTypes(consumer);
    }
    console.log(`Packed language-service smoke passed: ${basename(archive)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

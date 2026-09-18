import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface PackedFile {
  readonly path: string;
}

interface PackResult {
  readonly filename: string;
  readonly files: readonly PackedFile[];
}

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers/projection");
const forbiddenRuntime = [
  [/\bnode:[a-z][a-z0-9_/-]*/u, "node built-in"],
  [/\bprocess\s*\./u, "process global"],
  [/\beval\s*\(/u, "eval"],
  [/\bFunction\s*\(/u, "Function constructor"],
  [/\bimport\s*\(/u, "dynamic import"],
] as const;

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

function pack(workspace: string, destination: string): PackResult {
  const output = run(
    ["npm", "pack", "--json", "--workspace", workspace, "--pack-destination", destination],
    root,
  );
  const [result] = JSON.parse(output) as PackResult[];
  if (!result) throw new Error(`npm pack returned no artifact for ${workspace}`);
  return result;
}

function assertProjectionManifest(archive: string): void {
  const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
  const expectedExports = [".", "./projection-v1.schema.json", "./package.json"];
  if (manifest.name !== "@kalada/projection" || manifest.sideEffects !== false) {
    throw new Error("Projection package identity or sideEffects metadata drifted");
  }
  if (JSON.stringify(Object.keys(manifest.exports)) !== JSON.stringify(expectedExports)) {
    throw new Error("Projection package exports unintended entry points");
  }
  if (JSON.stringify(manifest.dependencies) !== JSON.stringify({ "@kalada/core": "^0.4.0" })) {
    throw new Error("Projection runtime dependency boundary drifted");
  }
  for (const field of ["devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[field] !== undefined) throw new Error(`Packed projection has ${field}`);
  }
}

function assertProjectionFiles(result: PackResult): void {
  const paths = result.files.map(({ path }) => path).sort();
  const required = [
    "README.md",
    "dist/index.cjs",
    "dist/index.d.cts",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
    "projection-v1.schema.json",
  ];
  for (const path of required) {
    if (!paths.includes(path)) throw new Error(`Packed projection is missing ${path}`);
  }
  const unexpected = paths.filter(
    (path) =>
      !required.includes(path) && path !== "dist/index.cjs.map" && path !== "dist/index.js.map",
  );
  if (unexpected.length > 0) throw new Error(`Unexpected packed files: ${unexpected.join(", ")}`);
}

function assertRuntimeText(text: string, label: string): void {
  for (const [pattern, name] of forbiddenRuntime) {
    if (pattern.test(text)) throw new Error(`${label} contains forbidden ${name}`);
  }
  for (const name of ["node:fs", "node:http", "node:https", "node:net", "node:tls"]) {
    if (text.includes(name)) throw new Error(`${label} contains forbidden ${name}`);
  }
}

function assertPackedRuntime(archive: string): void {
  for (const file of ["dist/index.js", "dist/index.cjs"]) {
    const text = run(["tar", "-xOf", archive, `package/${file}`], root);
    assertRuntimeText(text, file);
    const imports = [...text.matchAll(/(?:from\s*|require\()["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    if (imports.some((dependency) => dependency !== "@kalada/core/kalada-v1")) {
      throw new Error(`${file} imports an unintended runtime dependency: ${imports.join(", ")}`);
    }
  }
}

async function assertNoWorkspaceLeakage(archive: string, result: PackResult): Promise<void> {
  const workspace = await realpath(root);
  for (const { path } of result.files) {
    const content = run(["tar", "-xOf", archive, `package/${path}`], root);
    if (content.includes(workspace) || content.includes("workspace:")) {
      throw new Error(`${path} leaks a workspace path or protocol`);
    }
  }
}

async function createConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "projection-packed-consumer", private: true, type: "module" }),
  );
  for (const file of ["esm.mjs", "cjs.cjs", "types.mts", "types.cts", "browser.mjs"]) {
    await copyFile(join(fixtures, file), join(directory, file));
  }
}

function assertSingleCore(directory: string): void {
  const tree = run(["npm", "ls", "@kalada/core", "--all", "--parseable"], directory);
  const installations = tree
    .trim()
    .split("\n")
    .filter((path) => path.endsWith("node_modules/@kalada/core"));
  if (installations.length !== 1) {
    throw new Error(`Expected one physical @kalada/core, received ${installations.length}`);
  }
  console.log(tree.trim());
}

function runTypeConsumers(directory: string): void {
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
        "--resolveJsonModule",
        file,
      ],
      directory,
    );
  }
}

async function runConsumer(directory: string, archives: string[]): Promise<void> {
  await createConsumer(directory);
  run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], directory);
  assertSingleCore(directory);
  run(["npm", "ls", "--all"], directory);
  run(["node", "esm.mjs"], directory);
  run(["node", "cjs.cjs"], directory);
  runTypeConsumers(directory);
  run(["bun", "build", "browser.mjs", "--target=browser", "--outfile=browser.js"], directory);
  assertRuntimeText(await readFile(join(directory, "browser.js"), "utf8"), "browser bundle");
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-projection-smoke-"));
  try {
    const core = pack("@kalada/core", directory);
    const projection = pack("@kalada/projection", directory);
    const projectionArchive = join(directory, projection.filename);
    assertProjectionManifest(projectionArchive);
    assertProjectionFiles(projection);
    assertPackedRuntime(projectionArchive);
    await assertNoWorkspaceLeakage(projectionArchive, projection);
    await runConsumer(directory, [join(directory, core.filename), projectionArchive]);
    console.log(`Packed projection smoke passed: ${basename(projectionArchive)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

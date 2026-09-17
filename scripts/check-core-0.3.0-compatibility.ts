import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const core = resolve(root, "packages/core");
const fixture = JSON.parse(
  await readFile(resolve(root, "tests/fixtures/core-0.3.0-compatibility.json"), "utf8"),
);

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} drifted from @kalada/core@0.3.0`);
  }
}

function sortedExports(module: object): string[] {
  return Object.keys(module).sort();
}

function assertBaseline(actual: unknown, baseline: unknown, label: string): void {
  if (typeof baseline !== "object" || baseline === null) {
    assertEqual(actual, baseline, label);
    return;
  }
  if (typeof actual !== "object" || actual === null) throw new Error(`${label} was removed`);
  for (const [key, value] of Object.entries(baseline)) {
    assertBaseline((actual as Record<string, unknown>)[key], value, `${label}.${key}`);
  }
}

async function hash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function assertDeclaration(path: string, expected: string): Promise<void> {
  assertEqual(await hash(resolve(core, "dist", path)), expected, `${path} declaration`);
}

async function declarationSetHash(extension: string): Promise<string> {
  const directory = resolve(core, "dist/kuery-v1");
  const kuery = (await readdir(directory))
    .filter((file) => file.endsWith(extension))
    .map((file) => `kuery-v1/${file}`);
  const files = [`index${extension}`, `program-v1${extension}`, ...kuery].sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest
      .update(file)
      .update("\0")
      .update(await readFile(resolve(core, "dist", file)))
      .update("\0");
  }
  return digest.digest("hex");
}

const manifest = JSON.parse(await readFile(resolve(core, "package.json"), "utf8"));
for (const field of ["name", "sideEffects", "main", "module", "types"] as const) {
  assertEqual(manifest[field], fixture.package[field], `package ${field}`);
}
for (const [subpath, entry] of Object.entries(fixture.package.exports.exact)) {
  assertEqual(manifest.exports[subpath], entry, `package exports ${subpath}`);
}
for (const [subpath, entry] of Object.entries(fixture.package.exports.additiveBaseline)) {
  assertBaseline(manifest.exports[subpath], entry, `package exports ${subpath}`);
}
const expectedSubpaths = [
  ...Object.keys(fixture.package.exports.exact),
  ...Object.keys(fixture.package.exports.additiveBaseline),
].sort();
assertEqual(Object.keys(manifest.exports).sort(), expectedSubpaths, "package export subpaths");

function exportTarget(subpath: string, mode: "import" | "require"): string {
  const target = manifest.exports[subpath]?.[mode]?.default;
  if (typeof target !== "string") throw new Error(`package export ${subpath}.${mode} is invalid`);
  return resolve(core, target);
}

const esmRoot = await import(exportTarget(".", "import"));
const esmKuery = await import(exportTarget("./kuery-v1", "import"));
const esmKalada = await import(exportTarget("./kalada-v1", "import"));
const require = createRequire(import.meta.url);
const cjsRoot = require(exportTarget(".", "require"));
const cjsKuery = require(exportTarget("./kuery-v1", "require"));
const cjsKalada = require(exportTarget("./kalada-v1", "require"));

for (const [format, modules] of [
  ["ESM", [esmRoot, esmKuery, esmKalada]],
  ["CJS", [cjsRoot, cjsKuery, cjsKalada]],
] as const) {
  assertEqual(sortedExports(modules[0]), fixture.runtimeExports.root, `${format} root exports`);
  assertEqual(
    sortedExports(modules[1]),
    fixture.runtimeExports.kueryV1,
    `${format} kuery-v1 exports`,
  );
  for (const name of fixture.runtimeExports.kaladaV1) {
    if (!(name in modules[2]))
      throw new Error(`${format} kalada-v1 removed baseline export ${name}`);
  }
}

await assertDeclaration("index.d.ts", fixture.declarationSha256.rootEsm);
await assertDeclaration("index.d.cts", fixture.declarationSha256.rootCjs);
await assertDeclaration("kuery-v1/index.d.ts", fixture.declarationSha256.kueryV1Esm);
await assertDeclaration("kuery-v1/index.d.cts", fixture.declarationSha256.kueryV1Cjs);
assertEqual(
  await declarationSetHash(".d.ts"),
  fixture.declarationSha256.rootAndKueryV1EsmSet,
  "ESM root and kuery-v1 declaration set",
);
assertEqual(
  await declarationSetHash(".d.cts"),
  fixture.declarationSha256.rootAndKueryV1CjsSet,
  "CJS root and kuery-v1 declaration set",
);

for (const field of fixture.package.runtimeDependencyFields) {
  if (manifest[field] !== undefined) throw new Error(`package gained runtime ${field}`);
}

console.log("@kalada/core@0.3.0 compatibility passed (ESM, CJS, declarations, manifest)");

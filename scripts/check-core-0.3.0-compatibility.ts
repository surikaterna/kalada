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

const esmRoot = await import(resolve(core, "dist/index.js"));
const esmKuery = await import(resolve(core, "dist/kuery-v1/index.js"));
const esmKalada = await import(resolve(core, "dist/kalada-v1/index.js"));
const require = createRequire(import.meta.url);
const cjsRoot = require(resolve(core, "dist/index.cjs"));
const cjsKuery = require(resolve(core, "dist/kuery-v1/index.cjs"));
const cjsKalada = require(resolve(core, "dist/kalada-v1/index.cjs"));

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

const manifest = JSON.parse(await readFile(resolve(core, "package.json"), "utf8"));
assertEqual(Object.keys(manifest.exports).sort(), fixture.package.exportKeys, "package exports");
for (const field of fixture.package.runtimeDependencyFields) {
  if (manifest[field] !== undefined) throw new Error(`package gained runtime ${field}`);
}

console.log("@kalada/core@0.3.0 compatibility passed (ESM, CJS, declarations, manifest)");

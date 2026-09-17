import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const core = resolve(root, "packages/core");
const fixture = JSON.parse(
  await readFile(resolve(root, "tests/fixtures/core-0.4.0-compatibility.json"), "utf8"),
);

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} drifted from @kalada/core@0.4.0`);
  }
}

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return nested.flat();
}

async function declarationSet(extension: string): Promise<{ count: number; hash: string }> {
  const dist = resolve(core, "dist");
  const declarations = (await files(dist))
    .filter((path) => path.endsWith(extension))
    .sort((left, right) => left.localeCompare(right));
  const digest = createHash("sha256");
  for (const path of declarations) {
    digest
      .update(relative(dist, path))
      .update("\0")
      .update(await readFile(path))
      .update("\0");
  }
  return { count: declarations.length, hash: digest.digest("hex") };
}

async function fileHash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(resolve(core, "dist", path)))
    .digest("hex");
}

const manifest = JSON.parse(await readFile(resolve(core, "package.json"), "utf8"));
for (const field of ["name", "version", "sideEffects", "main", "module", "types"] as const) {
  assertEqual(manifest[field], fixture.package[field], `package ${field}`);
}
assertEqual(manifest.exports, fixture.package.exports, "package exports");
for (const field of fixture.package.runtimeDependencyFields) {
  assertEqual(manifest[field], undefined, `package ${field}`);
}

function target(subpath: string, mode: "import" | "require"): string {
  const path = manifest.exports[subpath]?.[mode]?.default;
  if (typeof path !== "string") throw new Error(`invalid ${subpath}.${mode} export`);
  return resolve(core, path);
}

const require = createRequire(import.meta.url);
for (const [subpath, names] of [
  [".", fixture.runtimeExports.root],
  ["./kuery-v1", fixture.runtimeExports.kueryV1],
  ["./kalada-v1", fixture.runtimeExports.kaladaV1],
] as const) {
  const esm = await import(target(subpath, "import"));
  const cjs = require(target(subpath, "require"));
  assertEqual(Object.keys(esm).sort(), names, `ESM ${subpath} exports`);
  assertEqual(Object.keys(cjs).sort(), names, `CJS ${subpath} exports`);
}

for (const [path, key] of [
  ["index.d.ts", "rootEsm"],
  ["index.d.cts", "rootCjs"],
  ["kuery-v1/index.d.ts", "kueryV1Esm"],
  ["kuery-v1/index.d.cts", "kueryV1Cjs"],
  ["kalada-v1/index.d.ts", "kaladaV1Esm"],
  ["kalada-v1/index.d.cts", "kaladaV1Cjs"],
] as const) {
  assertEqual(await fileHash(path), fixture.declarations[key], `${path} hash`);
}

const esm = await declarationSet(".d.ts");
const cjs = await declarationSet(".d.cts");
assertEqual(esm.count, fixture.declarations.esmFileCount, "ESM declaration count");
assertEqual(cjs.count, fixture.declarations.cjsFileCount, "CJS declaration count");
assertEqual(esm.hash, fixture.declarations.esmSetSha256, "ESM declaration set");
assertEqual(cjs.hash, fixture.declarations.cjsSetSha256, "CJS declaration set");

console.log("@kalada/core@0.4.0 exact compatibility passed (ESM, CJS, types, manifest)");

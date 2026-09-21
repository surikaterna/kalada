import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCoreEsmWrapper } from "../core-esm-wrapper.js";
import { run } from "./process.js";
import type { PackagePolicy, PackedPackage, PackResult } from "./types.js";

const dependencyFields = [
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
] as const;

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} drifted:\n${JSON.stringify(actual)}\n!=\n${JSON.stringify(expected)}`,
    );
  }
}

function archiveText(archive: string, path: string, root: string): string {
  return run(["tar", "-xOf", archive, `package/${path}`], root);
}

function runtimeImports(source: string): string[] {
  const specifier =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/gu;
  return [...source.matchAll(specifier)].map((match) => match[1] ?? "");
}

function assertManifest(manifest: Record<string, unknown>, policy: PackagePolicy): void {
  equal(manifest.name, policy.workspace, `${policy.workspace} name`);
  equal(manifest.type, "module", `${policy.workspace} type`);
  equal(manifest.main, "./dist/index.cjs", `${policy.workspace} main`);
  equal(manifest.module, "./dist/index.js", `${policy.workspace} module`);
  equal(manifest.types, "./dist/index.d.ts", `${policy.workspace} types`);
  equal(manifest.sideEffects, false, `${policy.workspace} sideEffects`);
  equal(manifest.files, policy.filesField, `${policy.workspace} files`);
  equal(manifest.exports, policy.exports, `${policy.workspace} exports and condition order`);
  equal(manifest.engines, { node: ">=22.0.0" }, `${policy.workspace} engines`);
  equal(manifest.dependencies ?? {}, policy.dependencies, `${policy.workspace} dependencies`);
  if ("browser" in manifest || JSON.stringify(manifest.exports).includes('"browser"')) {
    throw new Error(`${policy.workspace} must not declare a browser field or condition`);
  }
  for (const field of dependencyFields) {
    if (manifest[field] !== undefined)
      throw new Error(`${policy.workspace} unexpectedly has ${field}`);
  }
}

function assertContents(result: PackResult, policy: PackagePolicy): void {
  const actual = result.files.map(({ path }) => path).sort();
  equal(actual, [...policy.packedFiles].sort(), `${policy.workspace} packed files`);
}

function assertDeclarations(archive: string, policy: PackagePolicy, root: string): void {
  const esm = archiveText(archive, "dist/index.d.ts", root);
  const cjs = archiveText(archive, "dist/index.d.cts", root);
  equal(cjs, esm, `${policy.workspace} ESM/CJS declarations`);
}

function assertRuntime(
  archive: string,
  manifest: Record<string, unknown>,
  policy: PackagePolicy,
  root: string,
): void {
  for (const [path, expected] of Object.entries(policy.runtimeImports)) {
    const actual = runtimeImports(archiveText(archive, path, root));
    equal(actual, expected, `${policy.workspace} ${path} imports`);
  }
  if (policy.workspace !== "@kalada/core") return;
  equal(
    archiveText(archive, "dist/index.js", root),
    createCoreEsmWrapper(),
    "@kalada/core generated wrapper provenance",
  );
  equal(
    (manifest.scripts as Record<string, unknown> | undefined)?.build,
    "tsup && bun ../../scripts/write-core-esm-wrapper.ts",
    "@kalada/core wrapper build provenance",
  );
}

export function packPackage(
  policy: PackagePolicy,
  destination: string,
  root: string,
): PackedPackage {
  const output = run(
    ["npm", "pack", "--json", "--workspace", policy.workspace, "--pack-destination", destination],
    root,
  );
  const [result] = JSON.parse(output) as PackResult[];
  if (!result) throw new Error(`npm pack returned no artifact for ${policy.workspace}`);
  const archive = join(destination, result.filename);
  const manifest = JSON.parse(archiveText(archive, "package.json", root)) as Record<
    string,
    unknown
  >;
  return { archive, manifest, policy, result };
}

export async function assertPackedPackage(packed: PackedPackage, root: string): Promise<void> {
  await readFile(packed.archive);
  assertManifest(packed.manifest, packed.policy);
  assertContents(packed.result, packed.policy);
  assertDeclarations(packed.archive, packed.policy, root);
  assertRuntime(packed.archive, packed.manifest, packed.policy, root);
}

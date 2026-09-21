import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertPackedPackage, packPackage } from "./package-policy/archive.js";
import { assertPackedConsumers } from "./package-policy/consumer.js";
import { assertDependencyPolicy } from "./package-policy/dependencies.js";
import { packagePolicies } from "./package-policy/model.js";
import type { PackedPackage } from "./package-policy/types.js";

const root = resolve(import.meta.dirname, "..");

async function assertPolicyCoverage(): Promise<void> {
  const packageRoot = join(root, "packages");
  const names: string[] = [];
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      await readFile(join(packageRoot, entry.name, "package.json"), "utf8"),
    );
    if (manifest.private !== true && typeof manifest.name === "string") names.push(manifest.name);
  }
  const policies = packagePolicies.map(({ workspace }) => workspace).sort();
  if (JSON.stringify(names.sort()) !== JSON.stringify(policies)) {
    throw new Error(`Every publishable workspace needs package policy: ${names.join(", ")}`);
  }
}

function printPackedEvidence(packages: readonly PackedPackage[]): void {
  for (const packed of packages) {
    const rootExport = (packed.manifest.exports as Record<string, unknown>)["."];
    console.log(
      JSON.stringify({
        package: packed.policy.workspace,
        tarball: packed.result.filename,
        files: packed.result.files.map(({ path }) => path).sort(),
        exports: packed.manifest.exports,
        resolvedRootConditions: rootExport,
        engines: packed.manifest.engines,
        dependencies: packed.manifest.dependencies ?? {},
        browserCondition: "absent",
      }),
    );
  }
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-package-policy-"));
  try {
    await assertPolicyCoverage();
    const archives = join(directory, "archives");
    const consumer = join(directory, "consumer");
    await Promise.all([mkdir(archives), mkdir(consumer)]);
    const packages = packagePolicies.map((policy) => packPackage(policy, archives, root));
    await Promise.all(packages.map((packed) => assertPackedPackage(packed, root)));
    assertDependencyPolicy(
      packages.map(({ manifest, policy }) => ({
        name: policy.workspace,
        version: String(manifest.version),
        dependencies: manifest.dependencies,
        allowedDependencies: policy.dependencyNames,
      })),
    );
    const consumerEvidence = await assertPackedConsumers(consumer, root, packages);
    printPackedEvidence(packages);
    console.log(JSON.stringify(consumerEvidence));
    console.log(
      "Package policy passed: wrapper provenance, ESM/CJS/types, internal exclusions, and bundled browser",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

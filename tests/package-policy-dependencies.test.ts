import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDependencyPolicy,
  type PackageDependencyInput,
} from "../scripts/package-policy/dependencies.js";
import { packagePolicies } from "../scripts/package-policy/model.js";

const releasePlan: readonly PackageDependencyInput[] = [
  { name: "@kalada/core", version: "0.6.0", allowedDependencies: [] },
  {
    name: "@kalada/syntax",
    version: "0.1.0",
    dependencies: { "@kalada/core": "^0.6.0" },
    allowedDependencies: ["@kalada/core"],
  },
  {
    name: "@kalada/projection",
    version: "0.1.1",
    dependencies: { "@kalada/core": "^0.6.0" },
    allowedDependencies: ["@kalada/core"],
  },
];

async function branchPackages(): Promise<PackageDependencyInput[]> {
  return Promise.all(
    packagePolicies.map(async (policy) => {
      const directory = policy.workspace.slice("@kalada/".length);
      const path = resolve(import.meta.dirname, `../packages/${directory}/package.json`);
      const manifest = JSON.parse(await readFile(path, "utf8"));
      return {
        name: String(manifest.name),
        version: String(manifest.version),
        dependencies: manifest.dependencies,
        allowedDependencies: policy.dependencyNames,
      };
    }),
  );
}

function replace(
  packages: readonly PackageDependencyInput[],
  name: string,
  changes: Partial<PackageDependencyInput>,
): PackageDependencyInput[] {
  return packages.map((item) => (item.name === name ? { ...item, ...changes } : item));
}

describe("package dependency policy", () => {
  it("accepts normal branch manifests", async () => {
    const packages = await branchPackages();
    expect(() => assertDependencyPolicy(packages)).not.toThrow();
  });

  it("accepts the generated release plan from PR 63", () => {
    expect(() => assertDependencyPolicy(releasePlan)).not.toThrow();
  });

  it("accepts a workspace patch within the declared caret range", () => {
    const patched = replace(releasePlan, "@kalada/core", { version: "0.6.1" });
    expect(() => assertDependencyPolicy(patched)).not.toThrow();
  });

  it("rejects unexpected vendors", () => {
    const dependencies = { "@kalada/core": "^0.6.0", zod: "^4.0.0" };
    const invalid = replace(releasePlan, "@kalada/syntax", { dependencies });
    expect(() => assertDependencyPolicy(invalid)).toThrow(/dependencies must be exactly/u);
  });

  it("rejects a range that excludes the packed workspace version", () => {
    const dependencies = { "@kalada/core": "^0.5.0" };
    const invalid = replace(releasePlan, "@kalada/projection", { dependencies });
    expect(() => assertDependencyPolicy(invalid)).toThrow(/does not include packed/u);
  });

  it("rejects unsupported range shapes", () => {
    const dependencies = { "@kalada/core": "*" };
    const invalid = replace(releasePlan, "@kalada/syntax", { dependencies });
    expect(() => assertDependencyPolicy(invalid)).toThrow(/canonical caret range/u);
  });
});

import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./process.js";
import type { PackedPackage } from "./types.js";

const forbiddenBrowserHooks = [
  /["']node:/u,
  /\bprocess\s*\./u,
  /\bBuffer\b/u,
  /\brequire\s*\(/u,
  /\bmodule\s*\./u,
  /\beval\s*\(/u,
  /\bFunction\s*\(/u,
] as const;

async function createConsumer(directory: string, root: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "kalada-package-policy", private: true, type: "module" })}\n`,
  );
  await cp(resolve(root, "tests/consumers/package-policy"), directory, { recursive: true });
}

function installTarballs(directory: string, packages: readonly PackedPackage[]): void {
  run(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...packages.map(({ archive }) => archive),
    ],
    directory,
  );
}

function runTypes(directory: string, root: string): void {
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

async function runBrowserBundle(directory: string): Promise<void> {
  run(["bun", "build", "browser.mjs", "--target=browser", "--outfile=browser.js"], directory);
  const bundle = await readFile(join(directory, "browser.js"), "utf8");
  for (const pattern of forbiddenBrowserHooks) {
    if (pattern.test(bundle)) throw new Error(`Browser bundle contains forbidden ${pattern}`);
  }
  run(["node", "browser-runner.cjs"], directory);
}

export async function assertPackedConsumers(
  directory: string,
  root: string,
  packages: readonly PackedPackage[],
): Promise<Record<string, string>> {
  await createConsumer(directory, root);
  installTarballs(directory, packages);
  const nodeVersion = run(["node", "--version"], directory).trim();
  const dependencyTree = run(["npm", "ls", "--all"], directory).trim();
  const esmResolution = run(["node", "esm.mjs"], directory).trim();
  const cjsResolution = run(["node", "cjs.cjs"], directory).trim();
  runTypes(directory, root);
  await runBrowserBundle(directory);
  return { nodeVersion, dependencyTree, esmResolution, cjsResolution };
}

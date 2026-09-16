import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(command: string[], cwd: string): string {
  const [executable, ...args] = command;
  if (executable === undefined) throw new Error("A command is required");
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command.join(" ")}`);
  }
  return result.stdout;
}

async function createConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "kalada-package-smoke", private: true, type: "module" }),
  );
  await writeFile(
    join(directory, "index.mjs"),
    'import { KALADA_CORE_PACKAGE } from "@kalada/core";\n' +
      'if (KALADA_CORE_PACKAGE !== "@kalada/core") throw new Error("ESM identity mismatch");\n',
  );
  await writeFile(
    join(directory, "index.cjs"),
    'const { KALADA_CORE_PACKAGE } = require("@kalada/core");\n' +
      'if (KALADA_CORE_PACKAGE !== "@kalada/core") throw new Error("CJS identity mismatch");\n',
  );
  await writeFile(
    join(directory, "types.ts"),
    'import { KALADA_CORE_PACKAGE } from "@kalada/core";\n' +
      'const identity: "@kalada/core" = KALADA_CORE_PACKAGE;\nvoid identity;\n',
  );
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-package-smoke-"));
  try {
    const output = run(
      ["npm", "pack", "--json", "--workspace", "@kalada/core", "--pack-destination", directory],
      root,
    );
    const [{ filename }] = JSON.parse(output) as [{ filename: string }];
    const archive = join(directory, filename);
    await readFile(archive);
    await createConsumer(directory);
    run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    run(["node", "index.mjs"], directory);
    run(["node", "index.cjs"], directory);
    run([join(root, "node_modules", ".bin", "tsc"), "--strict", "--noEmit", "types.ts"], directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

await main();

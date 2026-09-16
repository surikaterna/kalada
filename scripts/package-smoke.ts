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
    'import * as root from "@kalada/core";\n' +
      'import { ExpressionProfile, standardV1 } from "@kalada/core/kuery-v1";\n' +
      'const again = await import("@kalada/core/kuery-v1");\n' +
      'if (Object.keys(root).sort().join() !== "canonicalizeKaladaProgramV1,fromKueryExpression,toKueryExpression") throw new Error("ESM root surface mismatch");\n' +
      'if (standardV1 !== again.standardV1 || !(standardV1 instanceof ExpressionProfile)) throw new Error("ESM identity mismatch");\n',
  );
  await writeFile(
    join(directory, "index.cjs"),
    'const root = require("@kalada/core");\n' +
      'const first = require("@kalada/core/kuery-v1");\n' +
      'const again = require("@kalada/core/kuery-v1");\n' +
      'if (Object.keys(root).sort().join() !== "canonicalizeKaladaProgramV1,fromKueryExpression,toKueryExpression") throw new Error("CJS root surface mismatch");\n' +
      'if (first.standardV1 !== again.standardV1 || !(first.standardV1 instanceof first.ExpressionProfile)) throw new Error("CJS identity mismatch");\n',
  );
  await writeFile(
    join(directory, "types.mts"),
    'import { fromKueryExpression, type KaladaProgramV1 } from "@kalada/core";\n' +
      'import { compileExpression, standardV1, type ValueExpression } from "@kalada/core/kuery-v1";\n' +
      'const expression: ValueExpression = { kind: "literal", value: true };\n' +
      "const result = fromKueryExpression(expression);\n" +
      "const program: KaladaProgramV1 | undefined = result.ok ? result.value : undefined;\n" +
      "void compileExpression(expression, { profile: standardV1 });\nvoid program;\n",
  );
  await writeFile(
    join(directory, "types.cts"),
    'import core = require("@kalada/core");\n' +
      'import kuery = require("@kalada/core/kuery-v1");\n' +
      'const expression: kuery.ValueExpression = { kind: "literal", value: true };\n' +
      "const result = core.fromKueryExpression(expression);\n" +
      "const program: core.KaladaProgramV1 | undefined = result.ok ? result.value : undefined;\n" +
      "void kuery.compileExpression(expression, { profile: kuery.standardV1 });\nvoid program;\n",
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
    for (const file of ["types.mts", "types.cts"]) {
      run(
        [
          join(root, "node_modules", ".bin", "tsc"),
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
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

await main();

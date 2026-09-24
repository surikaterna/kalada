import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(command: string[], cwd: string): string {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Missing command");
  const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function pack(directory: string): string {
  const output = run(
    [
      "npm",
      "pack",
      "--json",
      "--workspace",
      "@kalada/provider-routing",
      "--pack-destination",
      directory,
    ],
    root,
  );
  const [{ filename, files }] = JSON.parse(output) as [
    { filename: string; files: { path: string }[] },
  ];
  for (const path of [
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
    "README.md",
  ]) {
    if (!files.some((file) => file.path === path)) throw new Error(`Missing packed ${path}`);
  }
  const archive = join(directory, filename);
  const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root));
  if (manifest.dependencies || manifest.peerDependencies || manifest.optionalDependencies) {
    throw new Error("Neutral diagnostic artifact acquired a dependency");
  }
  return archive;
}

async function writeConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const sample = `const provider = { languageId: "domain", diagnose: () => ({ status: "supported", diagnostics: [] }) };\nconst snapshot = { uri: "file:///a", text: "🚀", version: 1, environmentGeneration: "one" };\nconst result = createDiagnosticRouter([provider]).diagnose("domain", snapshot);\nif (result.status !== "supported" || result.document.text !== "🚀" || DIAGNOSTIC_CONTRACT_VERSION !== 1) throw new Error("Routing failed");\n`;
  await writeFile(
    join(directory, "esm.mjs"),
    `import { createDiagnosticRouter, DIAGNOSTIC_CONTRACT_VERSION } from "@kalada/provider-routing";\n${sample}`,
  );
  await writeFile(
    join(directory, "cjs.cjs"),
    `const { createDiagnosticRouter, DIAGNOSTIC_CONTRACT_VERSION } = require("@kalada/provider-routing");\n${sample}`,
  );
  await writeFile(
    join(directory, "types.mts"),
    'import { createDiagnosticRouter, type DiagnosticProvider, DIAGNOSTIC_CONTRACT_VERSION } from "@kalada/provider-routing";\nconst provider: DiagnosticProvider = { languageId: "domain", diagnose: () => ({ status: "supported", diagnostics: [] }) };\nconst result = createDiagnosticRouter([provider]).diagnose("domain", { uri: "file:///a", text: "", version: 1, environmentGeneration: "one" });\nvoid result; void DIAGNOSTIC_CONTRACT_VERSION;\n',
  );
  await writeFile(
    join(directory, "types.cts"),
    'import routing = require("@kalada/provider-routing");\nconst provider: routing.DiagnosticProvider = { languageId: "domain", diagnose: () => ({ status: "supported", diagnostics: [] }) };\nvoid routing.createDiagnosticRouter([provider]);\n',
  );
}

function runConsumer(directory: string): void {
  run(["node", "esm.mjs"], directory);
  run(["node", "cjs.cjs"], directory);
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
        file,
      ],
      directory,
    );
  }
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-provider-routing-smoke-"));
  try {
    const archive = pack(directory);
    await writeConsumer(directory);
    run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    runConsumer(directory);
    const installed = JSON.parse(
      await readFile(join(directory, "node_modules/@kalada/provider-routing/package.json"), "utf8"),
    );
    if (installed.name !== "@kalada/provider-routing") throw new Error("Installed wrong package");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

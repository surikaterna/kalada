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
  const sample = `const provider = { languageId: "domain", diagnose: () => ({ status: "supported", diagnostics: [] }) };\nconst snapshot = { uri: "file:///a", text: "🚀", version: 1, environmentGeneration: "one" };\nconst result = createDiagnosticRouter([provider]).diagnose("domain", snapshot);\nif (result.status !== "supported" || result.document.text !== "🚀" || DIAGNOSTIC_CONTRACT_VERSION !== 1) throw new Error("Routing failed");\nconst composition = createCompositionRouter([{ version: 1, hostLanguageId: "host", position: "expression", allowedGuests: ["tiny"], open: "{", close: "}" }], [{ languageId: "tiny", parse: ({ start, meter }) => { meter.charge(1); return { owner: "tiny", status: "valid", stop: start + 1, range: { start, end: start + 1 }, reason: "host-close", diagnostics: [], subtree: {} }; } }]);\nconst composed = composition.compose({ snapshot: { ...snapshot, text: "{x}" }, hostLanguageId: "host", slots: [{ position: "expression", start: 0, maxStop: 2, explicitGuest: "tiny" }], isCurrent: () => true, limits: { work: 3, depth: 3, diagnostics: 2 } });\nif (composed.status !== "valid" || COMPOSITION_CONTRACT_VERSION !== 1) throw new Error("Composition failed");\n`;
  const earlySample = `const early = createCompositionRouter([{ version: 1, hostLanguageId: "host", position: "expression", allowedGuests: ["tiny"], open: "{", close: "}" }], [{ languageId: "tiny", parse: ({ start, meter }) => { meter.charge(1); return { owner: "tiny", status: "unsupported", stop: start, range: { start, end: start }, reason: "unsupported-quote", diagnostics: [{ owner: "tiny", code: "UNSUPPORTED_QUOTE", range: { start, end: start } }] }; } }]);
const earlyResult = early.compose({ snapshot: { ...snapshot, text: "{'bad}LATER" }, hostLanguageId: "host", slots: [{ position: "expression", start: 0, maxStop: 1, explicitGuest: "tiny" }], isCurrent: () => true, limits: { work: 2, depth: 3, diagnostics: 1 } });
if (earlyResult.status !== "unsupported" || earlyResult.reason !== "unsupported-quote" || earlyResult.tree !== undefined || earlyResult.diagnostics[0]?.range.start !== 1) throw new Error("Early diagnostics failed");
`;
  await writeFile(
    join(directory, "esm.mjs"),
    `import { createDiagnosticRouter, DIAGNOSTIC_CONTRACT_VERSION, createCompositionRouter, COMPOSITION_CONTRACT_VERSION } from "@kalada/provider-routing";\n${sample}${earlySample}`,
  );
  await writeFile(
    join(directory, "cjs.cjs"),
    `const { createDiagnosticRouter, DIAGNOSTIC_CONTRACT_VERSION, createCompositionRouter, COMPOSITION_CONTRACT_VERSION } = require("@kalada/provider-routing");\n${sample}${earlySample}`,
  );
  await writeFile(
    join(directory, "types.mts"),
    'import { createDiagnosticRouter, createCompositionRouter, type CompositionProfile, type CompositionGuest, type CompositionSlot, type DiagnosticProvider, DIAGNOSTIC_CONTRACT_VERSION } from "@kalada/provider-routing";\nconst provider: DiagnosticProvider = { languageId: "domain", diagnose: () => ({ status: "supported", diagnostics: [] }) };\nconst result = createDiagnosticRouter([provider]).diagnose("domain", { uri: "file:///a", text: "", version: 1, environmentGeneration: "one" });\nconst profile: CompositionProfile = { version: 1, hostLanguageId: "host", position: "slot", allowedGuests: ["tiny"], open: "{", close: "}" };\nconst slot: CompositionSlot = { position: "slot", start: 0, maxStop: 2 };\nconst guest: CompositionGuest = { languageId: "tiny", parse: ({ start, meter }) => { meter.charge(1); return { owner: "tiny", status: "valid", range: { start, end: start + 1 }, stop: start + 1, reason: "host-close", diagnostics: [], subtree: {} }; } };\nvoid createCompositionRouter([profile], [guest]); void slot; void result; void DIAGNOSTIC_CONTRACT_VERSION;\n',
  );
  await writeFile(
    join(directory, "types.cts"),
    'import routing = require("@kalada/provider-routing");\nconst provider: routing.DiagnosticProvider = { languageId: "domain", diagnose: () => ({ status: "supported", diagnostics: [] }) };\nconst profile: routing.CompositionProfile = { version: 1, hostLanguageId: "host", position: "slot", allowedGuests: ["tiny"], open: "{", close: "}" };\nvoid routing.createCompositionRouter([profile], []); void routing.createDiagnosticRouter([provider]);\n',
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

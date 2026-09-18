import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expectedRepositoryUrl = "https://github.com/surikaterna/kalada";

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

function runFailure(command: string[], cwd: string, expected: RegExp): void {
  const [executable, ...args] = command;
  if (!executable) throw new Error("A command is required");
  const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !expected.test(output)) {
    throw new Error(`Expected failure matching ${expected}: ${command.join(" ")}\n${output}`);
  }
}

async function createConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "kalada-package-smoke", private: true, type: "module" }),
  );
  const exports = [
    "DEFAULT_KALADA_V1_FUNCTION_LIMITS",
    "DEFAULT_KALADA_V1_LIMITS",
    "Duration",
    "Instant",
    "KALADA_VALUE_V1_SCHEMA",
    "KALADA_V1_FUNCTION_PROGRAM_SCHEMA",
    "KALADA_V1_PROGRAM_SCHEMA",
    "KaladaV1",
    "Option",
    "Result",
    "analyzeKaladaV1Functions",
    "canonicalizeKaladaV1Program",
    "collectKaladaV1Dependencies",
    "compileKaladaV1Program",
    "decodeKaladaValue",
    "encodeKaladaValue",
    "equalKaladaValues",
    "isDuration",
    "isInstant",
    "isOption",
    "isResult",
  ]
    .sort()
    .join(",");
  await writeFile(
    join(directory, "index.mjs"),
    'import { createRequire } from "node:module";\nimport * as core from "@kalada/core";\n' +
      `if(Object.keys(core).sort().join()!==${JSON.stringify(exports)})throw new Error("ESM root surface mismatch");\n` +
      'const cjs=createRequire(import.meta.url)("@kalada/core"); if(core.Option!==cjs.Option||core.Option.none()!==cjs.Option.none())throw new Error("ESM/CJS identity mismatch");\n' +
      'const p=core.compileKaladaV1Program(core.KaladaV1.program(core.KaladaV1.Option.some(core.KaladaV1.literal(1)))); const o=p.ok&&p.value.evaluate(()=>({found:false})); if(!o.ok||!core.isOption(o.value))throw new Error("native root failed");\n',
  );
  await writeFile(
    join(directory, "index.cjs"),
    'const core=require("@kalada/core"); if(!core.isResult(core.Result.ok(1)))throw new Error("CJS root failed"); if(core.Option.none()!==core.Option.none())throw new Error("singleton failed");\n',
  );
  await writeFile(
    join(directory, "types.mts"),
    'import { Instant, KaladaV1, compileKaladaV1Program, type KaladaV1Program } from "@kalada/core";\nconst native: KaladaV1Program=KaladaV1.program(KaladaV1.Option.none()); const compiled=compileKaladaV1Program(native); if(compiled.ok)compiled.value.evaluateWithClock(()=>({found:false}),()=>Instant.fromMilliseconds(0));\n',
  );
  await writeFile(
    join(directory, "types.cts"),
    'import core = require("@kalada/core");\nconst native: core.KaladaV1Program=core.KaladaV1.program(core.KaladaV1.Option.none()); const compiled=core.compileKaladaV1Program(native); void compiled;\n',
  );
  await writeFile(join(directory, "removed.cjs"), 'require("@kalada/core/kalada-v1");\n');
  await writeFile(join(directory, "dist.cjs"), 'require("@kalada/core/dist/index.cjs");\n');
  await writeFile(
    join(directory, "removed.mts"),
    'import { KaladaV1 } from "@kalada/core/kuery-v1";\nvoid KaladaV1;\n',
  );
}

function assertPackedRepository(archive: string): void {
  const manifest = JSON.parse(run(["tar", "-xOf", archive, "package/package.json"], root)) as {
    repository?: { url?: unknown };
  };
  if (manifest.repository?.url !== expectedRepositoryUrl) {
    throw new Error(
      `Packed repository.url must be ${expectedRepositoryUrl}; received ${String(manifest.repository?.url)}`,
    );
  }
}

async function packCoreCandidate(directory: string): Promise<string> {
  const candidate = join(directory, "core-0.5.0");
  await cp(join(root, "packages/core"), candidate, { recursive: true });
  const path = join(candidate, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.version = "0.5.0";
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const output = run(["npm", "pack", "--json", candidate, "--pack-destination", directory], root);
  const [{ filename }] = JSON.parse(output) as [{ filename: string }];
  return join(directory, filename);
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-package-smoke-"));
  try {
    const archive = await packCoreCandidate(directory);
    const projectionOutput = run(
      [
        "npm",
        "pack",
        "--json",
        "--workspace",
        "@kalada/projection",
        "--pack-destination",
        directory,
      ],
      root,
    );
    const [{ filename: projectionFilename }] = JSON.parse(projectionOutput) as [
      { filename: string },
    ];
    const projectionArchive = join(directory, projectionFilename);
    await Promise.all([readFile(archive), readFile(projectionArchive)]);
    assertPackedRepository(archive);
    assertPackedRepository(projectionArchive);
    await createConsumer(directory);
    run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    run(
      ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", projectionArchive],
      directory,
    );
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
          "--resolveJsonModule",
          file,
        ],
        directory,
      );
    }
    runFailure(["node", "removed.cjs"], directory, /ERR_PACKAGE_PATH_NOT_EXPORTED/u);
    runFailure(["node", "dist.cjs"], directory, /ERR_PACKAGE_PATH_NOT_EXPORTED/u);
    runFailure(
      [
        join(root, "node_modules", ".bin", "tsc"),
        "--noEmit",
        "--moduleResolution",
        "NodeNext",
        "--module",
        "NodeNext",
        "removed.mts",
      ],
      directory,
      /TS2307/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

await main();

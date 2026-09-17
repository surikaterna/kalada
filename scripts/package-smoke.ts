import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function createConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "kalada-package-smoke", private: true, type: "module" }),
  );
  await writeFile(
    join(directory, "index.mjs"),
    'import { createRequire } from "node:module";\n' +
      'import * as root from "@kalada/core";\n' +
      'import { ExpressionProfile, standardV1 } from "@kalada/core/kuery-v1";\n' +
      'import { Instant, KaladaV1 as K, Option, compileKaladaV1Program as compile, isInstant, isOption } from "@kalada/core/kalada-v1";\n' +
      'const again = await import("@kalada/core/kuery-v1");\n' +
      'const cjs = createRequire(import.meta.url)("@kalada/core/kalada-v1");\n' +
      'if (Object.keys(root).sort().join() !== "canonicalizeKaladaProgramV1,fromKueryExpression,toKueryExpression") throw new Error("ESM root surface mismatch");\n' +
      'if (standardV1 !== again.standardV1 || !(standardV1 instanceof ExpressionProfile)) throw new Error("ESM identity mismatch");\n' +
      'if (!isOption(Option.some(1))) throw new Error("ESM kalada-v1 mismatch");\n' +
      'if (!isInstant(Instant.fromMilliseconds(-1))) throw new Error("ESM temporal mismatch");\n' +
      'if (Option !== cjs.Option || Option.none() !== cjs.Option.none()) throw new Error("cross-loader singleton mismatch");\n' +
      'const n=K.Type.primitive("number"), j=K.Type.primitive("json");\n' +
      'const read=K.binding("x",K.literal(7),K.call(K.function([],n,K.ref("x")),[]));\n' +
      'const loop=K.functionGroup([K.namedFunction("loop",[K.parameter("x",K.Type.option(n))],n,K.match("Option",K.ref("x"),[K.arm("some",K.call(K.ref("loop"),[K.Option.none()])),K.arm("none",K.literal(7))]))],K.call(K.ref("loop"),[K.Option.some(K.literal(1))]));\n' +
      'const map=K.call(K.coreFunction("map"),[K.literal([8,9]),K.function([K.parameter("x",j),K.parameter("i",n)],j,K.ref("i"))]);\n' +
      'for (const [e,w] of [[read,7],[loop,7],[map,[0,1]]]) { const p=compile(K.program(e)); const o=p.ok&&p.value.evaluate(()=>({found:false})); if (!o.ok||JSON.stringify(o.value)!==JSON.stringify(w)) throw new Error("ESM function execution mismatch"); }\n',
  );
  await writeFile(
    join(directory, "index.cjs"),
    'const root = require("@kalada/core");\n' +
      'const first = require("@kalada/core/kuery-v1");\n' +
      'const again = require("@kalada/core/kuery-v1");\n' +
      'const kalada = require("@kalada/core/kalada-v1");\n' +
      'if (Object.keys(root).sort().join() !== "canonicalizeKaladaProgramV1,fromKueryExpression,toKueryExpression") throw new Error("CJS root surface mismatch");\n' +
      'if (first.standardV1 !== again.standardV1 || !(first.standardV1 instanceof first.ExpressionProfile)) throw new Error("CJS identity mismatch");\n' +
      'if (!kalada.isResult(kalada.Result.ok(1))) throw new Error("CJS kalada-v1 mismatch");\n' +
      'if (!kalada.isDuration(kalada.Duration.fromMilliseconds(-1))) throw new Error("CJS temporal mismatch");\n' +
      'if (kalada.Option.none() !== kalada.Option.none()) throw new Error("CJS singleton mismatch");\n' +
      'const K=kalada.KaladaV1,n=K.Type.primitive("number"),e=K.call(K.function([],n,K.literal(4)),[]),p=kalada.compileKaladaV1Program(K.program(e)),o=p.ok&&p.value.evaluate(()=>({found:false})); if(!o.ok||o.value!==4) throw new Error("CJS closure execution mismatch");\n',
  );
  await writeFile(
    join(directory, "types.mts"),
    'import { fromKueryExpression, type KaladaProgramV1 } from "@kalada/core";\n' +
      'import { compileExpression, standardV1, type ValueExpression } from "@kalada/core/kuery-v1";\n' +
      'import { Instant, KaladaV1, compileKaladaV1Program, type KaladaCoreFunctionName, type KaladaFunctionType, type KaladaV1Program } from "@kalada/core/kalada-v1";\n' +
      'const expression: ValueExpression = { kind: "literal", value: true };\n' +
      "const result = fromKueryExpression(expression);\n" +
      "const program: KaladaProgramV1 | undefined = result.ok ? result.value : undefined;\n" +
      "const native: KaladaV1Program = KaladaV1.program(KaladaV1.Option.none());\n" +
      'const coreName: KaladaCoreFunctionName = "map";\nconst functionType: KaladaFunctionType = { kind: "function-type", parameters: [], returns: { kind: "primitive-type", name: "number" } };\n' +
      "const compiled = compileKaladaV1Program(native);\nif (compiled.ok) compiled.value.evaluateWithClock(() => ({ found: false }), () => Instant.fromMilliseconds(0));\nvoid compileExpression(expression, { profile: standardV1 });\nvoid program; void coreName; void functionType;\n",
  );
  await writeFile(
    join(directory, "types.cts"),
    'import core = require("@kalada/core");\n' +
      'import kuery = require("@kalada/core/kuery-v1");\n' +
      'import kalada = require("@kalada/core/kalada-v1");\n' +
      'const expression: kuery.ValueExpression = { kind: "literal", value: true };\n' +
      "const result = core.fromKueryExpression(expression);\n" +
      "const program: core.KaladaProgramV1 | undefined = result.ok ? result.value : undefined;\n" +
      "const native: kalada.KaladaV1Program = kalada.KaladaV1.program(kalada.KaladaV1.Option.none());\n" +
      "const compiled = kalada.compileKaladaV1Program(native);\nif (compiled.ok) compiled.value.evaluateWithClock(() => ({ found: false }), () => kalada.Instant.fromMilliseconds(0));\nvoid kuery.compileExpression(expression, { profile: kuery.standardV1 });\nvoid program;\n",
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
    assertPackedRepository(archive);
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

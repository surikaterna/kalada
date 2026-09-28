import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const core = resolve(import.meta.dirname, "../packages/core/dist");
const runtimeExports = [
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
] as const;

const declarations = runtimeExports
  .map((name) => `export const ${name} = core.${name};`)
  .join("\n");
const wrapper = `import core from "./index.cjs";\n${declarations}\n`;
const cjsDeclarations = await readFile(resolve(core, "index.d.cts"), "utf8");
if (/\bfrom\s*["']\./u.test(cjsDeclarations)) {
  throw new Error("Core declarations must bundle local references before packaging");
}
for (const symbol of ["KaladaV1Program", "compileKaladaV1Program"]) {
  if (!new RegExp(`\\b${symbol}\\b`, "u").test(cjsDeclarations)) {
    throw new Error(`Core declarations are missing ${symbol}`);
  }
}
await Promise.all([
  writeFile(resolve(core, "index.js"), wrapper),
  copyFile(resolve(core, "index.d.cts"), resolve(core, "index.d.ts")),
]);

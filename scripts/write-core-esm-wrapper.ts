import { copyFile, writeFile } from "node:fs/promises";
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
await Promise.all([
  writeFile(resolve(core, "index.js"), wrapper),
  copyFile(resolve(core, "index.d.cts"), resolve(core, "index.d.ts")),
]);

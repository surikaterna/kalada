export const coreRuntimeExports = [
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

export function createCoreEsmWrapper(): string {
  const declarations = coreRuntimeExports
    .map((name) => `export const ${name} = core.${name};`)
    .join("\n");
  return `import core from "./index.cjs";\n${declarations}\n`;
}

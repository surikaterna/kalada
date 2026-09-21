import { type CompiledKaladaV1Program, compileKaladaV1Program } from "@kalada/core";
import {
  type KaladaLowerOutcome,
  type KaladaParseOptions,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";
import type { HostCompileProjection } from "./contracts.js";
import type {
  CompileExpressionResult,
  HostCompileOptions,
  HostParseOptions,
  ParsedExpression,
  ParseExpressionResult,
} from "./execution-contracts.js";
import { coreDiagnostic, executionDiagnostic, syntaxDiagnostics } from "./execution-diagnostics.js";
import { createFingerprint, HOST_COMPILE_FINGERPRINT_VERSION } from "./fingerprint.js";
import { validName } from "./input-readers.js";
import { cloneSemanticType } from "./semantic-type.js";
import { cloneSerializableData, readOwnDataRecord } from "./serializable.js";

const DEFAULT_URI = "memory:///expression.kalada";
const SYNTAX_CONTRACT = "kalada-syntax-lowering-result-v1";
const CORE_CONTRACT = "kalada-core-compiled-program-v1";

export function parseExpression(source: string, options?: HostParseOptions): ParseExpressionResult {
  const normalized = normalizeParseInput(source, options);
  if (!normalized) return failed(executionDiagnostic("HOST_PARSE_INVALID_SOURCE", "parse"));
  const syntax = parseKaladaV1Expression(source, normalized.syntax);
  if (syntax.diagnostics.length > 0)
    return failures(syntaxDiagnostics(syntax.diagnostics, normalized.source));
  return success(
    Object.freeze({
      format: "kalada-host-parsed-expression-v1" as const,
      source: normalized.source,
      syntax,
      parseFingerprintInput: normalized.fingerprintInput,
    }),
  );
}

export function compileExpression(
  parsed: ParsedExpression,
  projection: HostCompileProjection,
  options?: HostCompileOptions,
): CompileExpressionResult {
  const normalizedProjection = normalizeProjection(projection);
  if (!normalizedProjection) {
    return failed(executionDiagnostic("HOST_COMPILE_INVALID_PROJECTION", "compile"));
  }
  const normalizedOptions = normalizeCompileOptions(options);
  if (!normalizedOptions)
    return failed(executionDiagnostic("HOST_COMPILE_INVALID_OPTIONS", "compile"));
  const references = Object.fromEntries(
    normalizedProjection.bindings.map(({ id, name, semanticType }) => [
      name,
      Object.freeze({ reference: id, type: semanticType }),
    ]),
  );
  const lower = lowerKaladaV1Expression(parsed.syntax, {
    references,
    coreOptions: { limits: normalizedOptions.limits },
  });
  if (!lower.ok) return failures(syntaxDiagnostics(lower.diagnostics, parsed.source));
  const core = compileKaladaV1Program(lower.program, { limits: normalizedOptions.limits });
  if (!core.ok) {
    return failed(coreDiagnostic("compile", core.diagnostic, parsed.source, lower.sourceMap));
  }
  return success(
    compiledArtifact(parsed, normalizedProjection, normalizedOptions, lower, core.value),
  );
}

function compiledArtifact(
  parsed: Parameters<typeof compileExpression>[0],
  projection: HostCompileProjection,
  options: Readonly<{ profile: string; limits: Readonly<Record<string, number>> }>,
  lower: Extract<KaladaLowerOutcome<string>, { ok: true }>,
  core: CompiledKaladaV1Program<string>,
) {
  const projectionFingerprint = createFingerprint(projection.format, projection);
  const compileFingerprint = createFingerprint(HOST_COMPILE_FINGERPRINT_VERSION, {
    syntaxContract: SYNTAX_CONTRACT,
    coreContract: CORE_CONTRACT,
    source: parsed.source,
    parseOptions: parsed.parseFingerprintInput,
    profile: options.profile,
    limits: options.limits,
    projection,
    program: lower.program,
  });
  return Object.freeze({
    format: "kalada-host-compiled-expression-v1" as const,
    source: parsed.source,
    parsed,
    program: lower.program,
    sourceMap: lower.sourceMap,
    coreCompilation: core,
    dependencies: core.dependencies,
    resultType: lower.resultType,
    compileProjectionFingerprint: projectionFingerprint,
    compileFingerprint,
  });
}

function normalizeParseInput(source: unknown, options: unknown) {
  if (typeof source !== "string") return null;
  if (options === undefined) return parseInput(source, DEFAULT_URI, undefined);
  const inspected = readOwnDataRecord(options, 4);
  if (!inspected.ok) return null;
  const uri = inspected.value.sourceUri ?? DEFAULT_URI;
  if (typeof uri !== "string" || uri.length === 0) return null;
  if (inspected.value.syntax === undefined) return parseInput(source, uri, undefined);
  const cloned = cloneSerializableData(inspected.value.syntax);
  if (!cloned.ok) return null;
  return parseInput(source, uri, cloned.value as KaladaParseOptions | undefined);
}

function parseInput(text: string, uri: string, syntax: KaladaParseOptions | undefined) {
  const source = Object.freeze({ uri, text });
  const fingerprintInput = Object.freeze({ uri, syntax: syntax ?? null });
  return { source, syntax, fingerprintInput };
}

function normalizeCompileOptions(
  options: unknown,
): Readonly<{ profile: string; limits: Readonly<Record<string, number>> }> | null {
  if (options === undefined)
    return Object.freeze({ profile: "default", limits: Object.freeze({}) });
  const inspected = readOwnDataRecord(options, 4);
  if (!inspected.ok) return null;
  const profile = inspected.value.profile ?? "default";
  if (typeof profile !== "string" || profile.length === 0) return null;
  const limits = cloneLimits(inspected.value.limits);
  return limits ? Object.freeze({ profile, limits }) : null;
}

function cloneLimits(input: unknown): Readonly<Record<string, number>> | null {
  if (input === undefined) return Object.freeze({});
  const inspected = readOwnDataRecord(input, 32);
  if (!inspected.ok) return null;
  const output: Record<string, number> = Object.create(null);
  for (const [key, value] of Object.entries(inspected.value)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    output[key] = value;
  }
  return Object.freeze(output);
}

function normalizeProjection(input: unknown): HostCompileProjection | null {
  const cloned = cloneSerializableData(input);
  if (!cloned.ok) return null;
  const value = cloned.value as unknown as HostCompileProjection;
  if (value.format !== "kalada-host-compile-projection-v1" || !Array.isArray(value.bindings)) {
    return null;
  }
  const identities = new Set<string>();
  const names = new Set<string>();
  const bindings: HostCompileProjection["bindings"][number][] = [];
  for (const inputBinding of value.bindings) {
    const inspected = readOwnDataRecord(inputBinding, 4);
    if (!inspected.ok) return null;
    const { id, name, semanticType } = inspected.value;
    const semantic = cloneSemanticType(semanticType);
    if (!validName(id) || !validName(name) || !semantic.ok) return null;
    if (identities.has(id as string) || names.has(name as string)) return null;
    identities.add(id as string);
    names.add(name as string);
    bindings.push(
      Object.freeze({ id: id as string, name: name as string, semanticType: semantic.value }),
    );
  }
  return Object.freeze({
    format: "kalada-host-compile-projection-v1",
    bindings: Object.freeze(bindings),
  });
}

function success<T>(value: T) {
  return Object.freeze({ ok: true as const, value });
}

function failed(diagnostic: ReturnType<typeof executionDiagnostic>) {
  return failures([diagnostic]);
}

function failures(diagnostics: readonly ReturnType<typeof executionDiagnostic>[]) {
  return Object.freeze({ ok: false as const, diagnostics: Object.freeze([...diagnostics]) });
}

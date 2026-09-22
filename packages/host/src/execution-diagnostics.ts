import type { KaladaV1Diagnostic } from "@kalada/core";
import type {
  KaladaSourceMapEntry,
  KaladaSourceRange,
  KaladaSyntaxDiagnostic,
} from "@kalada/syntax";
import type { HostDiagnostic, HostDiagnosticPhase, ProvenanceEntry } from "./contracts.js";
import type { HostExecutionDiagnosticCode, HostExpressionSource } from "./execution-contracts.js";

const MESSAGES: Readonly<Record<HostExecutionDiagnosticCode, string>> = Object.freeze({
  HOST_PARSE_INVALID_SOURCE: "The expression source declaration is invalid.",
  HOST_COMPILE_INVALID_OPTIONS: "The expression compile options are invalid.",
  HOST_COMPILE_INVALID_PROJECTION: "The environment compile projection is invalid.",
  HOST_LINK_INCOMPATIBLE_ENVIRONMENT:
    "The compiled expression is incompatible with the environment.",
  HOST_LINK_MISSING_BINDING: "A compiled dependency is unavailable in the environment.",
  HOST_LINK_INVALID_CAPABILITY: "A linked capability snapshot is invalid.",
  HOST_LINK_ASYNC_UNSUPPORTED:
    "An asynchronous declaration is unsupported by synchronous execution.",
  HOST_BINDING_MISSING: "A linked binding is not an own data property.",
  HOST_BINDING_DECODE: "A linked binding could not be decoded synchronously.",
  HOST_BINDING_CONVERSION: "A linked binding could not be converted synchronously.",
  HOST_BINDING_SEMANTIC: "A linked binding is not a valid value of its semantic type.",
});

export function executionDiagnostic(
  code: HostExecutionDiagnosticCode,
  phase: HostDiagnosticPhase,
  bindingPath?: readonly (string | number)[],
  provenance?: ProvenanceEntry,
): HostDiagnostic {
  return Object.freeze({
    code,
    phase,
    message: MESSAGES[code],
    ...(bindingPath ? { bindingPath: Object.freeze([...bindingPath]) } : {}),
    ...(provenance ? { provenance: sanitizedProvenance(provenance) } : {}),
  });
}

export function syntaxDiagnostics(
  diagnostics: readonly KaladaSyntaxDiagnostic[],
  source: HostExpressionSource,
): readonly HostDiagnostic[] {
  return Object.freeze(
    diagnostics.map((cause) =>
      Object.freeze({
        code: cause.code,
        phase: cause.phase === "lower" ? ("lower" as const) : ("parse" as const),
        message: cause.message,
        source: sourceLocation(source, cause.range),
        cause,
      }),
    ),
  );
}

export function coreDiagnostic(
  phase: "compile" | "evaluate",
  cause: KaladaV1Diagnostic,
  source: HostExpressionSource,
  sourceMap: readonly KaladaSourceMapEntry[],
): HostDiagnostic {
  const fallback = Object.freeze({ start: 0, end: source.text.length });
  return Object.freeze({
    code: cause.code,
    phase,
    message: cause.message,
    source: sourceLocation(source, mappedRange(sourceMap, cause.path, fallback)),
    cause,
  });
}

function mappedRange(
  entries: readonly KaladaSourceMapEntry[],
  path: readonly (string | number)[],
  fallback: KaladaSourceRange,
): KaladaSourceRange {
  const exact = entries.filter((entry) => equalPath(entry.path, path)).sort(byNarrowest)[0];
  if (exact) return exact.range;
  for (let length = path.length - 1; length > 0; length -= 1) {
    const found = entries.find(
      (entry) => entry.role === "node" && equalPath(entry.path, path.slice(0, length)),
    );
    if (found) return found.range;
  }
  return fallback;
}

function sourceLocation(source: HostExpressionSource, range: KaladaSourceRange) {
  return Object.freeze({
    uri: source.uri,
    range: Object.freeze({
      start: positionAt(source.text, range.start),
      end: positionAt(source.text, range.end),
    }),
  });
}

function positionAt(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const lastBreak = prefix.lastIndexOf("\n");
  return Object.freeze({
    line: prefix.split("\n").length - 1,
    character: offset - lastBreak - 1,
  });
}

function equalPath(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function byNarrowest(left: KaladaSourceMapEntry, right: KaladaSourceMapEntry): number {
  return left.range.end - left.range.start - (right.range.end - right.range.start);
}

function sanitizedProvenance(input: ProvenanceEntry): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null);
  for (const key of ["providerId", "providerVersion", "source", "extractor", "override"] as const) {
    const value = input[key];
    if (value !== undefined) output[key] = value;
  }
  return Object.freeze(output);
}

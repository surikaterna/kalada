import type { DescribeEnvironmentResult } from "@kalada/host";
import type { LanguageServiceDiagnostic } from "./contracts.js";
import { createUtf16LineIndex } from "./line-index.js";
import { createLanguageService } from "./service.js";

// Structural diagnostic routing contract; the private routing prototype is not a package dependency.
export interface ExpressionsDocument {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
  readonly environmentGeneration: string;
}

export interface ExpressionsEnvironment {
  readonly environmentGeneration: string;
  readonly description: DescribeEnvironmentResult;
}

export type ExpressionsEnvironmentResolver = (
  generation: string,
) => ExpressionsEnvironment | undefined;

export interface ExpressionsDiagnostic {
  readonly code: string;
  readonly range: Readonly<{ readonly start: number; readonly end: number }>;
}

export interface ExpressionsDiagnosticProvider {
  readonly languageId: string;
  diagnose(document: ExpressionsDocument):
    | {
        readonly status: "supported" | "invalid";
        readonly diagnostics: readonly ExpressionsDiagnostic[];
      }
    | { readonly status: "unsupported"; readonly diagnostics?: never };
}

const UNKNOWN_RANGE = Object.freeze({ start: 0, end: 0 });

function projectDiagnostic(
  diagnostic: LanguageServiceDiagnostic,
  document: ExpressionsDocument,
  index: ReturnType<typeof createUtf16LineIndex>,
): ExpressionsDiagnostic {
  const source = diagnostic.source;
  if (!source || source.uri !== document.uri) {
    return { code: diagnostic.code, range: UNKNOWN_RANGE };
  }
  try {
    const start = index.offsetAt(source.range.start);
    const end = index.offsetAt(source.range.end);
    if (end < start) return { code: diagnostic.code, range: UNKNOWN_RANGE };
    return { code: diagnostic.code, range: { start, end } };
  } catch {
    // An unmappable host location is unknown, not an asserted source position.
    return { code: diagnostic.code, range: UNKNOWN_RANGE };
  }
}

/** Opt-in whole-document diagnostic adapter; each request uses only its resolved environment. */
export function createExpressionsDiagnosticProvider(
  resolveEnvironment: ExpressionsEnvironmentResolver,
): ExpressionsDiagnosticProvider {
  return {
    languageId: "expressions",
    diagnose(document) {
      const resolved = resolveEnvironment(document.environmentGeneration);
      if (!resolved || resolved.environmentGeneration !== document.environmentGeneration) {
        return {
          status: "invalid",
          diagnostics: [{ code: "EXPRESSIONS_ENVIRONMENT_UNAVAILABLE", range: UNKNOWN_RANGE }],
        };
      }
      const service = createLanguageService({ generation: 0, description: resolved.description });
      service.openDocument(document);
      const result = service.diagnostics(document.uri);
      if (result.kind !== "diagnostics" || !service.isCurrent(result)) {
        return {
          status: "invalid",
          diagnostics: [{ code: "EXPRESSIONS_ANALYSIS_UNAVAILABLE", range: UNKNOWN_RANGE }],
        };
      }
      const index = createUtf16LineIndex(document.text);
      const diagnostics = result.diagnostics.map((item) =>
        projectDiagnostic(item, document, index),
      );
      return { status: diagnostics.length ? "invalid" : "supported", diagnostics };
    },
  };
}

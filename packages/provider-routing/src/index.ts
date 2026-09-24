/** Experimental diagnostic contract v1; not a parser, checker, or runtime API. */
export const DIAGNOSTIC_CONTRACT_VERSION = 1;
export interface DocumentSnapshot {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
  readonly environmentGeneration: string;
}

export interface Diagnostic {
  readonly code: string;
  readonly range: Readonly<{ readonly start: number; readonly end: number }>;
}

export type ProviderOutcome =
  | { readonly status: "supported"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "invalid"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "unsupported"; readonly diagnostics?: never };

export interface DiagnosticProvider {
  readonly languageId: string;
  diagnose(document: DocumentSnapshot): ProviderOutcome;
}

export type RoutedOutcome = ProviderOutcome & {
  readonly languageId: string;
  readonly document: DocumentSnapshot;
};

// Fixed qualitative safety bounds, not calibrated platform budgets.
const MAX_TEXT = 100_000;
const MAX_IDENTITY = 2_048;
const MAX_DIAGNOSTICS = 100;
const MAX_CODE = 128;

function invalid(code: string): ProviderOutcome {
  return Object.freeze({
    status: "invalid" as const,
    diagnostics: Object.freeze([
      Object.freeze({ code, range: Object.freeze({ start: 0, end: 0 }) }),
    ]),
  });
}

function validDocument(value: DocumentSnapshot): boolean {
  return (
    typeof value?.uri === "string" &&
    value.uri.length > 0 &&
    value.uri.length <= MAX_IDENTITY &&
    typeof value.text === "string" &&
    Number.isSafeInteger(value.version) &&
    value.version >= 0 &&
    typeof value.environmentGeneration === "string" &&
    value.environmentGeneration.length > 0 &&
    value.environmentGeneration.length <= MAX_IDENTITY
  );
}

function validDiagnostic(code: string, start: number, end: number, length: number): boolean {
  return (
    /^[A-Z][A-Z0-9_]*$/u.test(code) &&
    code.length <= MAX_CODE &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= length
  );
}

function copyDiagnostic(item: Diagnostic, length: number): Diagnostic | undefined {
  const code = item?.code;
  const range = item?.range;
  const start = range?.start;
  const end = range?.end;
  if (
    typeof code !== "string" ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    !validDiagnostic(code, start, end, length)
  )
    return undefined;
  return Object.freeze({ code, range: Object.freeze({ start, end }) });
}

function safeOutcome(value: ProviderOutcome, length: number): ProviderOutcome {
  const status = value?.status;
  if (status === "unsupported") {
    if ("diagnostics" in value) return invalid("PROVIDER_INVALID_RESULT");
    return Object.freeze({ status: "unsupported" });
  }
  if (status !== "supported" && status !== "invalid") return invalid("PROVIDER_INVALID_RESULT");
  const source = value.diagnostics;
  if (!Array.isArray(source)) return invalid("PROVIDER_INVALID_RESULT");
  const count = source.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_DIAGNOSTICS)
    return invalid("PROVIDER_INVALID_RESULT");
  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < count; index++) {
    const item = source[index];
    const copied = copyDiagnostic(item, length);
    if (!copied) return invalid("PROVIDER_INVALID_RESULT");
    diagnostics.push(copied);
  }
  if ((status === "supported") !== (diagnostics.length === 0))
    return invalid("PROVIDER_INVALID_RESULT");
  if (status === "supported")
    return Object.freeze({ status: "supported", diagnostics: Object.freeze(diagnostics) });
  return Object.freeze({ status: "invalid", diagnostics: Object.freeze(diagnostics) });
}

export function createDiagnosticRouter(providers: readonly DiagnosticProvider[]) {
  const registered = new Map<string, DiagnosticProvider>();
  for (const provider of providers) {
    const languageId = provider?.languageId;
    if (typeof languageId !== "string" || !languageId.trim())
      throw new Error("Invalid language ID");
    if (registered.has(languageId)) throw new Error("Duplicate language ID");
    if (typeof provider.diagnose !== "function") throw new Error("Invalid provider");
    registered.set(languageId, provider);
  }
  return Object.freeze({
    diagnose(languageId: string, input: DocumentSnapshot): RoutedOutcome {
      const provider = registered.get(languageId);
      if (!provider) throw new Error("Unknown language ID");
      const document = Object.freeze({
        uri: input?.uri,
        text: input?.text,
        version: input?.version,
        environmentGeneration: input?.environmentGeneration,
      });
      if (!validDocument(document)) throw new Error("Invalid document identity");
      let outcome: ProviderOutcome;
      if (document.text.length > MAX_TEXT) outcome = invalid("PROVIDER_SOURCE_LIMIT");
      else {
        try {
          outcome = safeOutcome(provider.diagnose(document), document.text.length);
        } catch {
          outcome = invalid("PROVIDER_FAILURE");
        }
      }
      return Object.freeze({ ...outcome, languageId, document });
    },
  });
}

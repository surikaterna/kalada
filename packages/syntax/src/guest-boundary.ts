import type { KaladaSourceRange } from "./cst-types.js";
import { DiagnosticSink } from "./diagnostics.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import { type GuestLexResult, lexGuest } from "./lexer.js";
import { resolveSyntaxLimits } from "./limits.js";
import { parseTokens } from "./parse.js";
import type {
  KaladaParseOptions,
  KaladaParseResult,
  KaladaSyntaxDiagnostic,
  KaladaSyntaxLimits,
} from "./public-types.js";

export interface GuestBoundaryResult {
  readonly ok: boolean;
  readonly range: KaladaSourceRange;
  readonly stop: number;
  readonly reason:
    | "outer-brace"
    | "unmatched-parentheses"
    | "unsupported-comment"
    | "unsupported-quote"
    | "eof"
    | "limit"
    | "invalid-start";
  readonly parsed: KaladaParseResult | null;
  readonly diagnostics: readonly KaladaSyntaxDiagnostic[];
}

/**
 * Experimental opt-in syntax seam, not a host grammar contract.
 * The host declares start and independently checks/consumes source[stop] === "}".
 * Only current supported Kalada expressions succeed; future grammar belongs to the guest lexer.
 * An unterminated supported double-quoted string is ambiguous: scanning remains bounded by
 * maxSourceLength and fails closed, but cannot identify a brace inside that string as host-owned.
 */
export function parseGuestExpressionPrefix(
  source: string,
  start: number,
  options?: KaladaParseOptions,
): GuestBoundaryResult {
  let limits: KaladaSyntaxLimits | null;
  try {
    limits = resolveSyntaxLimits(options);
  } catch {
    limits = null;
  }
  if (
    typeof source !== "string" ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > source.length ||
    limits === null
  ) {
    return deepFreeze({
      ok: false,
      range: freezeRange(0, 0),
      stop: 0,
      reason: "invalid-start",
      parsed: null,
      diagnostics: [],
    });
  }
  const scanned = lexGuest(source, start, limits);
  const stop = scanned.stop ?? scanned.tokens[scanned.tokens.length - 1]?.range.start ?? start;
  const sink = new DiagnosticSink(limits, scanned.diagnostics);
  const limited = sink.diagnostics.some((item) => item.code === "KALADA_SYNTAX_LIMIT_EXCEEDED");
  const reason = guestStopReason(scanned, limited);
  if (reason === "eof")
    sink.add("parse", "KALADA_SYNTAX_UNEXPECTED_TOKEN", freezeRange(stop, stop));
  const parsed = parseTokens(source, scanned.tokens, limits, sink.diagnostics);
  return deepFreeze({
    ok: reason === "outer-brace" && parsed.diagnostics.length === 0,
    range: freezeRange(start, stop),
    stop,
    reason,
    parsed,
    diagnostics: parsed.diagnostics,
  });
}

function guestStopReason(scanned: GuestLexResult, limited: boolean): GuestBoundaryResult["reason"] {
  if (scanned.stop === null) return limited ? "limit" : "eof";
  if (scanned.unsupportedComment) return "unsupported-comment";
  if (scanned.unsupportedQuote) return "unsupported-quote";
  return scanned.unmatchedParentheses ? "unmatched-parentheses" : "outer-brace";
}

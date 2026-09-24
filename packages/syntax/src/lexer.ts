import type { KaladaToken, KaladaTokenKind } from "./cst-types.js";
import { DiagnosticSink, diagnostic } from "./diagnostics.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import {
  type GuestTokenState,
  isDigit,
  limitedToken,
  scanNumber,
  scanString,
  token,
} from "./lex-literals.js";
import type { KaladaSyntaxDiagnostic, KaladaSyntaxLimits } from "./public-types.js";

export interface LexResult {
  readonly tokens: readonly KaladaToken[];
  readonly diagnostics: readonly KaladaSyntaxDiagnostic[];
}

export interface GuestLexResult extends LexResult {
  readonly stop: number | null;
  readonly unmatchedParentheses: boolean;
  readonly unsupportedComment: boolean;
  readonly unsupportedQuote: boolean;
}

const VALID_OPERATORS = [
  "??",
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "<",
  ">",
];
const UNSUPPORTED_OPERATORS = [
  "===",
  "!==",
  "=>",
  "**",
  "++",
  "--",
  "<<",
  ">>",
  "^",
  "&",
  "|",
  "=",
  "~",
];

export function lex(source: string, limits: KaladaSyntaxLimits): LexResult {
  const sink = new DiagnosticSink(limits);
  if (source.length > limits.maxSourceLength) {
    sink.limit("lex", freezeRange(0, source.length));
    return result(
      [token("invalid", source, 0, source.length), token("eof", "", source.length, source.length)],
      sink,
    );
  }
  const tokens: KaladaToken[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (tokens.length >= limits.maxTokens) {
      sink.limit("lex", freezeRange(offset, source.length));
      tokens.push(token("invalid", source.slice(offset), offset, source.length));
      offset = source.length;
      break;
    }
    const next = scanToken(source, offset, limits, sink);
    tokens.push(next);
    offset = next.range.end;
  }
  tokens.push(token("eof", "", source.length, source.length));
  return result(tokens, sink);
}

// The bounded window prevents any token scanner (including strings/comments) from reading host tail.
export function lexGuest(
  source: string,
  start: number,
  limits: KaladaSyntaxLimits,
): GuestLexResult {
  const window = source.slice(start, start + limits.maxSourceLength + 1);
  const scanned = scanGuest(window, limits);
  return deepFreeze({
    stop: scanned.stop === null ? null : start + scanned.stop,
    unmatchedParentheses: scanned.unmatchedParentheses,
    unsupportedComment: scanned.unsupportedComment,
    unsupportedQuote: scanned.unsupportedQuote,
    tokens: scanned.tokens.map((item) =>
      token(item.kind, item.text, start + item.range.start, start + item.range.end),
    ),
    diagnostics: scanned.diagnostics.map((item) =>
      diagnostic(
        item.phase,
        item.code,
        item.message,
        freezeRange(start + item.range.start, start + item.range.end),
        item.path,
      ),
    ),
  });
}

function scanGuest(source: string, limits: KaladaSyntaxLimits): GuestLexResult {
  const sink = new DiagnosticSink(limits);
  const tokens: KaladaToken[] = [];
  let offset = 0;
  let depth = 0;
  let unmatchedParentheses = false;
  let unsupportedComment = false;
  let unsupportedQuote = false;
  let stop: number | null = null;
  while (offset < source.length) {
    if (source[offset] === "}") {
      stop = offset;
      unmatchedParentheses ||= depth !== 0;
      break;
    }
    if (offset >= limits.maxSourceLength || tokens.length >= limits.maxTokens) {
      sink.limit("lex", freezeRange(offset, offset));
      break;
    }
    const opener = ambiguousGuestOpener(source, offset);
    if (opener !== null) {
      // Ownership is ambiguous at this seam; never scan the body for a host brace.
      sink.add("lex", "KALADA_SYNTAX_UNSUPPORTED_FORM", freezeRange(offset, offset));
      stop = offset;
      unsupportedComment = opener === "comment";
      unsupportedQuote = opener === "quote";
      break;
    }
    const guest: GuestTokenState = { limited: false };
    const next = scanToken(source, offset, limits, sink, guest);
    tokens.push(next);
    offset = next.range.end;
    if (guest.limited) break;
    depth += parenthesisDelta(next);
    unmatchedParentheses ||= depth < 0;
    if (offset > limits.maxSourceLength)
      sink.limit("lex", freezeRange(limits.maxSourceLength, offset));
  }
  if (stop === null && source.length > limits.maxSourceLength) {
    sink.limit("lex", freezeRange(limits.maxSourceLength, limits.maxSourceLength));
  }
  return finishGuest(tokens, sink, offset, {
    stop,
    unmatchedParentheses,
    unsupportedComment,
    unsupportedQuote,
  });
}

function finishGuest(
  tokens: KaladaToken[],
  sink: DiagnosticSink,
  offset: number,
  state: Pick<
    GuestLexResult,
    "stop" | "unmatchedParentheses" | "unsupportedComment" | "unsupportedQuote"
  >,
): GuestLexResult {
  tokens.push(token("eof", "", offset, offset));
  return deepFreeze({
    tokens,
    diagnostics: sink.diagnostics,
    ...state,
  });
}

function ambiguousGuestOpener(source: string, offset: number): "comment" | "quote" | null {
  if (source.startsWith("//", offset) || source.startsWith("/*", offset)) return "comment";
  if (source[offset] === "'" || source[offset] === "`") return "quote";
  return null;
}

function parenthesisDelta(found: KaladaToken): number {
  if (found.kind === "left-parenthesis") return 1;
  if (found.kind === "right-parenthesis") return -1;
  return 0;
}

function scanToken(
  source: string,
  start: number,
  limits: KaladaSyntaxLimits,
  sink: DiagnosticSink,
  guest?: GuestTokenState,
): KaladaToken {
  const character = source[start] as string;
  if (isWhitespace(character)) return scanWhile(source, start, isWhitespace, "whitespace");
  if (isIdentifierStart(character)) return scanIdentifier(source, start, limits, sink, guest);
  if (isDigit(character)) return scanNumber(source, start, sink);
  if (character === '"') return scanString(source, start, limits, sink, guest);
  return scanSymbol(source, start, sink);
}

function scanSymbol(source: string, start: number, sink: DiagnosticSink): KaladaToken {
  const character = source[start] as string;
  if (
    (character === "/" && source[start + 1] === "/") ||
    (character === "/" && source[start + 1] === "*")
  ) {
    return scanComment(source, start, sink);
  }
  if (character === "'" || character === "`") return scanQuotedUnsupported(source, start, sink);
  if (source.startsWith("?.", start)) return token("optional-dot", "?.", start, start + 2);
  const unsupported = matchAt(source, start, UNSUPPORTED_OPERATORS);
  const operator = matchAt(source, start, VALID_OPERATORS);
  if (unsupported && (!operator || unsupported.length > operator.length)) {
    return unsupportedToken(source, start, unsupported.length, sink, "operator");
  }
  if (operator) return token("operator", operator, start, start + operator.length);
  if (unsupported) return unsupportedToken(source, start, unsupported.length, sink, "operator");
  const navigation = scanNavigation(source, start);
  if (navigation) return navigation;
  if ("[]{};,".includes(character)) return unsupportedToken(source, start, 1, sink, "form");
  sink.add("lex", "KALADA_SYNTAX_UNEXPECTED_TOKEN", freezeRange(start, start + 1));
  return token("invalid", character, start, start + 1);
}

function scanIdentifier(
  source: string,
  start: number,
  limits: KaladaSyntaxLimits,
  sink: DiagnosticSink,
  guest?: GuestTokenState,
): KaladaToken {
  const found = scanWhile(source, start, isIdentifierContinue, "identifier");
  if (found.text.length > limits.maxIdentifierLength) {
    return limitedToken(source, start, found.range.end, sink, guest);
  }
  const keyword = (["true", "false", "null", "in", "xor"] as const).find(
    (item) => item === found.text,
  );
  return keyword ? token(keyword, found.text, found.range.start, found.range.end) : found;
}

function scanComment(source: string, start: number, sink: DiagnosticSink): KaladaToken {
  const line = source.startsWith("//", start);
  let end = start + 2;
  if (line) while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
  else {
    const close = source.indexOf("*/", end);
    end = close < 0 ? source.length : close + 2;
  }
  return unsupportedToken(source, start, end - start, sink, "form");
}

function scanQuotedUnsupported(source: string, start: number, sink: DiagnosticSink): KaladaToken {
  const quote = source[start];
  let end = start + 1;
  while (
    end < source.length &&
    source[end] !== quote &&
    source[end] !== "\n" &&
    source[end] !== "\r"
  )
    end += 1;
  if (source[end] === quote) end += 1;
  return unsupportedToken(source, start, end - start, sink, "form");
}

function scanNavigation(source: string, start: number): KaladaToken | null {
  if (source.startsWith("?.", start)) return token("optional-dot", "?.", start, start + 2);
  const kinds: Readonly<Record<string, KaladaTokenKind>> = {
    "(": "left-parenthesis",
    ")": "right-parenthesis",
    ".": "dot",
    "?": "question",
    ":": "colon",
  };
  const text = source[start] as string;
  return kinds[text] ? token(kinds[text], text, start, start + 1) : null;
}

function unsupportedToken(
  source: string,
  start: number,
  length: number,
  sink: DiagnosticSink,
  type: "form" | "operator",
): KaladaToken {
  const end = start + length;
  sink.add(
    "lex",
    type === "form" ? "KALADA_SYNTAX_UNSUPPORTED_FORM" : "KALADA_SYNTAX_UNSUPPORTED_OPERATOR",
    freezeRange(start, end),
  );
  return token("unsupported", source.slice(start, end), start, end);
}

function scanWhile(
  source: string,
  start: number,
  predicate: (value: string) => boolean,
  kind: KaladaTokenKind,
): KaladaToken {
  let end = start + 1;
  while (end < source.length && predicate(source[end] as string)) end += 1;
  return token(kind, source.slice(start, end), start, end);
}

function matchAt(source: string, start: number, values: readonly string[]): string | null {
  return (
    [...values]
      .sort((left, right) => right.length - left.length)
      .find((value) => source.startsWith(value, start)) ?? null
  );
}

function result(tokens: KaladaToken[], sink: DiagnosticSink): LexResult {
  return deepFreeze({ tokens, diagnostics: sink.diagnostics });
}

function isWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function isIdentifierStart(value: string): boolean {
  return value?.length === 1 && /[A-Za-z_]/u.test(value);
}

function isIdentifierContinue(value: string): boolean {
  return value?.length === 1 && /[A-Za-z0-9_]/u.test(value);
}

import type { KaladaToken, KaladaTokenKind } from "./cst-types.js";
import type { DiagnosticSink } from "./diagnostics.js";
import { freezeRange } from "./freeze.js";
import type { KaladaSyntaxLimits } from "./public-types.js";

// A guest scanner supplies state so a lexical limit cannot be confused with a malformed literal.
export interface GuestTokenState {
  limited: boolean;
}

export function token(
  kind: KaladaTokenKind,
  text: string,
  start: number,
  end: number,
): KaladaToken {
  return Object.freeze({ kind, text, range: freezeRange(start, end) });
}

export function limitedToken(
  source: string,
  start: number,
  end: number,
  sink: DiagnosticSink,
  guest?: GuestTokenState,
): KaladaToken {
  const limitEnd = guest ? end : source.length;
  sink.limit("lex", freezeRange(start, limitEnd));
  if (guest) guest.limited = true;
  return token("invalid", source.slice(start, limitEnd), start, limitEnd);
}

export function scanNumber(source: string, start: number, sink: DiagnosticSink): KaladaToken {
  let end = scanDigits(source, start);
  if (source[end] === "." && isDigit(source[end + 1] as string)) {
    end = scanDigits(source, end + 1);
  }
  if (source[end] === "e" || source[end] === "E") {
    end += 1;
    if (source[end] === "+" || source[end] === "-") end += 1;
    end = scanDigits(source, end);
  }
  let text = source.slice(start, end);
  let valid = validNumber(text);
  if (source[end] === "." && !(valid && isIdentifierStart(source[end + 1] as string))) {
    end += 1;
    text = source.slice(start, end);
    valid = false;
  }
  if (!valid) sink.add("lex", "KALADA_SYNTAX_INVALID_NUMBER", freezeRange(start, end));
  return token(valid ? "number" : "invalid", text, start, end);
}

function scanDigits(source: string, start: number): number {
  let end = start;
  while (end < source.length && isDigit(source[end] as string)) end += 1;
  return end;
}

function validNumber(text: string): boolean {
  return (
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(text) &&
    Number.isFinite(Number(text))
  );
}

export function scanString(
  source: string,
  start: number,
  limits: KaladaSyntaxLimits,
  sink: DiagnosticSink,
  guest?: GuestTokenState,
): KaladaToken {
  let end = start + 1;
  let escaped = false;
  while (end < source.length) {
    const character = source[end] as string;
    end += 1;
    if (!escaped && character === '"') break;
    escaped = !escaped && character === "\\";
    if (character !== "\\") escaped = false;
  }
  const text = source.slice(start, end);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (typeof value === "string" && value.length > limits.maxDecodedStringLength) {
    return limitedToken(source, start, end, sink, guest);
  }
  const valid = typeof value === "string";
  if (!valid) sink.add("lex", "KALADA_SYNTAX_INVALID_STRING", freezeRange(start, end));
  return token(valid ? "string" : "invalid", text, start, end);
}

function isIdentifierStart(value: string): boolean {
  return value?.length === 1 && /[A-Za-z_]/u.test(value);
}

export function isDigit(value: string): boolean {
  return /[0-9]/u.test(value);
}

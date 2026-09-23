import { parseKaladaV1Expression } from "@kalada/syntax";

type Span = { readonly start: number; readonly end: number };
type Failure = {
  readonly status: "invalid" | "unsupported" | "exhausted";
  readonly reason: string;
};
type Success = {
  readonly status: "supported";
  readonly opening: Span;
  readonly guest: Span;
  readonly closing: Span;
  readonly continuation: Span;
  readonly tail: Span;
};

type Scan = { readonly status: "candidate"; readonly close: number } | Failure;
type ScanState = { depth: number; quoted: boolean; escaped: boolean };

// Toy host protocol: an explicitly positioned @expr{...}|tail slot; | is the host return marker.
export function composeToyHost(
  source: string,
  openingOffset: number,
  budget: number,
): Success | Failure {
  if (
    !Number.isSafeInteger(openingOffset) ||
    openingOffset < 5 ||
    source.slice(openingOffset - 5, openingOffset + 1) !== "@expr{"
  ) {
    return { status: "invalid", reason: "undeclared slot" };
  }
  const start = openingOffset + 1;
  const scanned = scanGuest(source, start, budget);
  if (scanned.status !== "candidate") return scanned;
  const close = scanned.close;
  if (close === start) return { status: "invalid", reason: "no guest progress" };
  if (source[close + 1] !== "|") {
    return { status: "invalid", reason: "missing or ambiguous host return" };
  }
  const guest = source.slice(start, close);
  const parsed = parseKaladaV1Expression(guest);
  if (
    parsed.diagnostics.length !== 0 ||
    parsed.document.source !== guest ||
    parsed.document.expression.kind === "error" ||
    parsed.document.tokens.at(-1)?.kind !== "eof" ||
    parsed.document.tokens.at(-1)?.range.start !== guest.length
  ) {
    return { status: "invalid", reason: "guest did not parse completely" };
  }
  return {
    status: "supported",
    opening: { start: openingOffset, end: start },
    guest: { start, end: close },
    closing: { start: close, end: close + 1 },
    continuation: { start: close + 1, end: close + 2 },
    tail: { start: close + 2, end: source.length },
  };
}

function scanGuest(source: string, start: number, budget: number): Scan {
  if (!Number.isSafeInteger(budget) || budget < 1) {
    return { status: "exhausted", reason: "scanner budget" };
  }
  const state: ScanState = { depth: 0, quoted: false, escaped: false };
  for (let index = start; index < source.length; index += 1) {
    if (index - start >= budget) return { status: "exhausted", reason: "scanner budget" };
    const outcome = scanUnit(source, index, state);
    if (outcome) return outcome;
  }
  return { status: "invalid", reason: state.quoted ? "unterminated quote" : "missing close" };
}

function scanUnit(source: string, index: number, state: ScanState): Scan | null {
  const char = source[index];
  if (state.quoted) return scanQuotedUnit(char, state);
  if (char === '"') state.quoted = true;
  else if (char === "(") state.depth += 1;
  else if (char === ")") {
    if (state.depth === 0) return { status: "invalid", reason: "unbalanced parentheses" };
    state.depth -= 1;
  } else if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
    return { status: "unsupported", reason: "comment lexing" };
  } else if (char === "{" || (char === "}" && state.depth > 0)) {
    return { status: "unsupported", reason: "guest brace lexing" };
  } else if (char === "}") return { status: "candidate", close: index };
  return null;
}

function scanQuotedUnit(char: string | undefined, state: ScanState): Failure | null {
  if (char === "\n" || char === "\r") {
    return { status: "unsupported", reason: "newline in string" };
  }
  if (state.escaped) state.escaped = false;
  else if (char === "\\") state.escaped = true;
  else if (char === '"') state.quoted = false;
  return null;
}

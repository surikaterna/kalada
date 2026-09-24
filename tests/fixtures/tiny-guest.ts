import type { Guest, GuestResult, Meter } from "./host-profile.js";

// Deliberately independent: ASCII decimal additions, spaces, and a host-owned closing brace.
// The scanner never searches ahead for a delimiter inside an unsupported lexical form.
export const tinyGuest: Guest = (source, start, meter): GuestResult => {
  const initialWork = meter.work;
  const { at, expectNumber, seen, error } = scan(source, start, meter);
  const reason = error
    ? "unsupported-token"
    : meter.remainingWork < 1
      ? "limit"
      : at === source.length
        ? "eof"
        : "outer-brace";
  const ok = reason === "outer-brace" && seen && !expectNumber;
  const diagnostics = ok ? [] : [{ code: "TINY_EXPECTED_DECIMAL", range: { start: at, end: at } }];
  return Object.freeze({
    ok,
    chargedWork: meter.work - initialWork,
    reason,
    stop: at,
    range: { start, end: at },
    diagnostics,
    parsed: { document: { source }, diagnostics },
  });
};

function scan(source: string, start: number, meter: Meter) {
  let at = start;
  let expectNumber = true;
  let seen = false;
  let error = false;
  while (at < source.length && meter.remainingWork > 0) {
    const ch = source[at];
    if (ch === "}") break;
    if (ch === " " || ch === "\t") {
      meter.advance(1);
      at++;
      continue;
    }
    if (expectNumber && digit(ch)) {
      at = consumeDigits(source, at, meter);
      expectNumber = false;
      seen = true;
      continue;
    }
    if (ch === "+" && !expectNumber) {
      expectNumber = true;
      meter.advance(1);
      at++;
      continue;
    }
    error = true;
    break;
  }
  return { at, expectNumber, seen, error };
}

function digit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function consumeDigits(source: string, from: number, meter: Meter): number {
  let at = from;
  while (at < source.length && meter.remainingWork > 0 && digit(source[at])) {
    meter.advance(1);
    at++;
  }
  return at;
}

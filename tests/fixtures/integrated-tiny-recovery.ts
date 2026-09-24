import type { Attempt, OwnedRange, Recovery } from "./host-recovery.js";

function recognizeSlot(source: string, start: number, slot: 1 | 2) {
  const token = /^[0-9+ \t]*/u.exec(source.slice(start))?.[0] ?? "";
  const at = start + token.length;
  const closer = source[at] === "}";
  const complete = /^[ \t]*[0-9]+(?:[ \t]*\+[ \t]*[0-9]+)*[ \t]*$/u.test(token);
  const reason = closer ? "outer-brace" : at === source.length ? "eof" : "unsupported-token";
  const diagnostics =
    complete && closer ? [] : [{ code: "TINY_EXPECTED_DECIMAL", range: { start: at, end: at } }];
  return { slot, start, stop: at, reason, diagnostics } as Attempt;
}

function hostFrame(source: string, at: number, slot: 1 | 2, ranges: OwnedRange[]): boolean {
  if (slot === 1) {
    if (!source.startsWith("}next{", at)) return false;
    ranges.push({ start: at, end: at + 6, owner: "host" });
    return true;
  }
  if (/[{}]/u.test(source.slice(at + 1))) return false;
  ranges.push({ start: at, end: source.length, owner: "host" });
  return true;
}

// Whole-document tiny recognizer: an anchored token grammar, not delegated scanning.
// It accepts ASCII decimal additions only, with the literal two-slot host frame.
export function integratedTinyRecovery(
  source: string,
): Pick<Recovery, "status" | "stop" | "ranges" | "attempts"> {
  const ranges: OwnedRange[] = [];
  const attempts: Attempt[] = [];
  let stop: number | null = null;
  const result = (status: Recovery["status"]) => ({ status, stop, ranges, attempts });
  const prefix = source.startsWith("🚀\r\n") ? "🚀\r\n" : "";
  if (!source.startsWith("host{", prefix.length)) return result("invalid");
  let start = prefix.length + 5;
  for (const slot of [1, 2] as const) {
    const attempt = recognizeSlot(source, start, slot);
    const at = attempt.stop;
    attempts.push(attempt);
    if (attempt.reason !== "outer-brace")
      return result(attempt.reason === "eof" ? "partial" : "unsupported");
    stop = at;
    if (slot === 1) ranges.push({ start: 0, end: start, owner: "host" });
    if (attempt.diagnostics.length === 0) ranges.push({ start, end: at, owner: "tiny" });
    if (!hostFrame(source, at, slot, ranges)) return result("partial");
    start = at + 6;
  }
  return result(attempts.every((item) => item.diagnostics.length === 0) ? "valid" : "partial");
}

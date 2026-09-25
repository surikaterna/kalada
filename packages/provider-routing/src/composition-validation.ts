import type {
  CompositionDiagnostic,
  CompositionOutcome,
  CompositionProfile,
  CompositionRequest,
  CompositionSnapshot,
  GuestCompositionResult,
} from "./contracts.js";

const MAX_ID = 2048;
const MAX_DIAGNOSTICS = 100;
export const id = (s: unknown): s is string =>
  typeof s === "string" && !!s.trim() && s.length <= MAX_ID;
export const offset = (n: number, length: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= length;
export const range = (start: number, end: number) => Object.freeze({ start, end });

export function outcome(
  status: CompositionOutcome["status"],
  reason: string,
  document: CompositionSnapshot,
  diagnostics: readonly CompositionDiagnostic[] = [],
): CompositionOutcome {
  return Object.freeze({
    status,
    reason,
    snapshot: document,
    diagnostics: Object.freeze([...diagnostics]),
  });
}
export function checkpoint(
  request: CompositionRequest,
  document: CompositionSnapshot,
): "stale" | "cancelled" | undefined {
  if (request.isCancelled?.()) return "cancelled";
  const original = request.snapshot;
  if (
    original.uri !== document.uri ||
    original.text !== document.text ||
    original.version !== document.version ||
    original.environmentGeneration !== document.environmentGeneration
  )
    return "stale";
  if (!request.isCurrent(document)) return "stale";
}

/** Reject ambiguous declared ownership, including later out-of-order slots. */
export function declaredSlotsClear(
  slots: readonly import("./contracts.js").CompositionSlot[],
  index: number,
  boundary: number,
  length: number,
): boolean {
  let previous = slots[index]?.start;
  if (previous === undefined || !offset(previous, length)) return false;
  for (let i = index + 1; i < slots.length; i++) {
    const start = slots[i]?.start;
    if (start === undefined || !offset(start, length)) return false;
    if (start <= previous || start < boundary) return false;
    previous = start;
  }
  return true;
}

export function boundedExit(
  result: GuestCompositionResult,
  owner: string,
  start: number,
  length: number,
  maxStop: number | undefined,
): boolean {
  const stop = result?.stop;
  return (
    result?.owner === owner &&
    offset(stop, length) &&
    stop >= start &&
    (maxStop === undefined || stop <= maxStop) &&
    result.range?.start === start &&
    result.range?.end === stop &&
    typeof result.reason === "string" &&
    !!result.reason &&
    (result.status === "valid" ||
      result.status === "invalid" ||
      result.status === "partial" ||
      result.status === "unsupported")
  );
}

export function snapshot(input: CompositionSnapshot): CompositionSnapshot {
  const copy = Object.freeze({
    uri: input?.uri,
    text: input?.text,
    version: input?.version,
    environmentGeneration: input?.environmentGeneration,
  });
  if (
    !id(copy.uri) ||
    typeof copy.text !== "string" ||
    !Number.isSafeInteger(copy.version) ||
    copy.version < 0 ||
    !id(copy.environmentGeneration)
  )
    throw new Error("Invalid snapshot");
  return copy;
}
export function profileCopy(p: CompositionProfile): CompositionProfile {
  const allowedGuests = [...p.allowedGuests];
  if (
    p.version !== 1 ||
    !id(p.hostLanguageId) ||
    !id(p.position) ||
    !id(p.open) ||
    !id(p.close) ||
    !allowedGuests.length ||
    allowedGuests.some((guest) => !id(guest)) ||
    new Set(allowedGuests).size !== allowedGuests.length ||
    (p.defaultGuest !== undefined && !allowedGuests.includes(p.defaultGuest))
  )
    throw new Error("Invalid or ambiguous composition profile");
  return Object.freeze({
    version: 1,
    hostLanguageId: p.hostLanguageId,
    position: p.position,
    open: p.open,
    close: p.close,
    defaultGuest: p.defaultGuest,
    allowedGuests: Object.freeze(allowedGuests),
  });
}
export function diagnosticCopy(
  items: readonly CompositionDiagnostic[],
  regionStart: number,
  stop: number,
  owner: string,
): readonly CompositionDiagnostic[] | undefined {
  if (!Array.isArray(items) || items.length > MAX_DIAGNOSTICS) return;
  const result: CompositionDiagnostic[] = [];
  for (const item of items) {
    const code = item?.code,
      start = item?.range?.start,
      end = item?.range?.end;
    if (
      typeof code !== "string" ||
      code.length > 128 ||
      !/^[A-Z][A-Z0-9_]*$/u.test(code) ||
      item?.owner !== owner ||
      !offset(start, stop) ||
      !offset(end, stop) ||
      start < regionStart ||
      end < start
    )
      return;
    result.push(Object.freeze({ owner, code, range: range(start, end) }));
  }
  return Object.freeze(result);
}

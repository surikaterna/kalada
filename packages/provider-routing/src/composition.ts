import { Meter } from "./composition-meter.js";
import type {
  CompositionDiagnostic,
  CompositionGuest,
  CompositionMeter,
  CompositionNode,
  CompositionOutcome,
  CompositionProfile,
  CompositionRange,
  CompositionRequest,
  CompositionSlot,
  CompositionSnapshot,
  GuestCompositionResult,
} from "./contracts.js";

const MAX_TEXT = 100_000;
const MAX_ID = 2048;
const MAX_WORK = 1_000_000;
const MAX_DEPTH = 32;
const MAX_DIAGNOSTICS = 100;
const id = (s: unknown): s is string => typeof s === "string" && !!s.trim() && s.length <= MAX_ID;
const range = (start: number, end: number): CompositionRange => Object.freeze({ start, end });
const offset = (n: number, length: number) => Number.isSafeInteger(n) && n >= 0 && n <= length;

function snapshot(input: CompositionSnapshot): CompositionSnapshot {
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
function profileCopy(p: CompositionProfile): CompositionProfile {
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
function outcome(
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
function checkpoint(
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
function diagnosticCopy(
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
type Entry = Readonly<{ profile: CompositionProfile; guest: CompositionGuest }>;
function select(
  slot: CompositionSlot,
  host: string,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
): Entry | undefined {
  const profile = profiles.find((p) => p.hostLanguageId === host && p.position === slot.position);
  if (!profile) return;
  const chosen = slot.explicitGuest ?? profile.defaultGuest;
  if (!chosen || !profile.allowedGuests.includes(chosen)) return;
  const guest = guests.get(chosen);
  return guest ? { profile, guest } : undefined;
}
function node(
  owner: string,
  start: number,
  end: number,
  children: readonly CompositionNode[] = [],
  subtree?: unknown,
): CompositionNode {
  return Object.freeze({
    owner,
    range: range(start, end),
    children: Object.freeze([...children]),
    subtree,
  });
}

/** Registered callbacks are trusted/cooperative; this meter cannot preempt CPU or memory use. */
export function createCompositionRouter(
  profiles: readonly CompositionProfile[],
  providers: readonly CompositionGuest[],
) {
  const registered = profiles.map(profileCopy);
  const keys = registered.map((p) => `${p.hostLanguageId}\0${p.position}`);
  if (new Set(keys).size !== keys.length) throw new Error("Overlapping host positions");
  const guests = new Map<string, CompositionGuest>();
  for (const provider of providers) {
    const languageId = provider?.languageId,
      parse = provider?.parse;
    if (!id(languageId) || typeof parse !== "function" || guests.has(languageId))
      throw new Error("Invalid or duplicate guest");
    guests.set(languageId, Object.freeze({ languageId, parse: parse.bind(provider) }));
  }
  return Object.freeze({
    compose(request: CompositionRequest): CompositionOutcome {
      const document = snapshot(request.snapshot);
      const limits = Object.freeze({ ...request.limits });
      if (
        !Number.isSafeInteger(limits.work) ||
        limits.work < 1 ||
        limits.work > MAX_WORK ||
        !Number.isSafeInteger(limits.depth) ||
        limits.depth < 1 ||
        limits.depth > MAX_DEPTH ||
        !Number.isSafeInteger(limits.diagnostics) ||
        limits.diagnostics < 0 ||
        limits.diagnostics > MAX_DIAGNOSTICS
      )
        throw new Error("Invalid budget");
      const meter = request.meter ?? new Meter(limits);
      try {
        return compose(request, document, meter, registered, guests);
      } catch {
        return outcome("invalid", "COMPOSITION_FAILURE", document);
      }
    },
  });
}

function compose(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
): CompositionOutcome {
  const state = checkpoint(request, document);
  if (state) return outcome(state, state, document);
  if (document.text.length > MAX_TEXT) return outcome("budget", "SOURCE_LIMIT", document);
  if (
    !id(request.hostLanguageId) ||
    !Array.isArray(request.slots) ||
    request.slots.length > MAX_DIAGNOSTICS
  )
    return outcome("invalid", "INVALID_HOST", document);
  if (!meter.enter()) return outcome("budget", "DEPTH_LIMIT", document);
  try {
    return walk(request, document, meter, profiles, guests);
  } finally {
    meter.leave();
  }
}

function walk(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
): CompositionOutcome {
  const children: CompositionNode[] = [];
  let cursor = 0;
  for (const slot of request.slots) {
    const state = checkpoint(request, document);
    if (state) return outcome(state, state, document);
    if (!offset(slot?.start, document.text.length) || slot.start < cursor)
      return outcome("invalid", "OVERLAPPING_SLOT", document);
    const processed = processSlot(request, document, meter, profiles, guests, slot, cursor);
    if ("status" in processed) return processed;
    const { start, stop, close, guest, subtree } = processed;
    if (slot.start > cursor) children.push(node(request.hostLanguageId, cursor, slot.start));
    children.push(node(request.hostLanguageId, slot.start, start));
    children.push(node(guest, start, stop, [], subtree));
    cursor = stop + close.length;
    children.push(node(request.hostLanguageId, stop, cursor));
  }
  if (!meter.charge(document.text.length - cursor) || meter.exhausted)
    return outcome("budget", "WORK_LIMIT", document);
  const state = checkpoint(request, document);
  if (state) return outcome(state, state, document);
  if (cursor < document.text.length)
    children.push(node(request.hostLanguageId, cursor, document.text.length));
  return Object.freeze({
    status: "valid",
    reason: "complete",
    snapshot: document,
    diagnostics: Object.freeze([]),
    tree: node(request.hostLanguageId, 0, document.text.length, children),
  });
}

type Accepted = { start: number; stop: number; close: string; guest: string; subtree: unknown };
function boundedExit(
  result: GuestCompositionResult,
  entry: Entry,
  start: number,
  length: number,
  maxStop: number | undefined,
): boolean {
  const stop = result?.stop;
  return (
    result?.owner === entry.guest.languageId &&
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
function admit(
  result: GuestCompositionResult,
  entry: Entry,
  start: number,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  maxStop: number | undefined,
  guestWork: number,
): Accepted | CompositionOutcome {
  // Read callback-owned fields once: accessors must not change the validated exit later.
  const guestRange = result.range;
  const value: GuestCompositionResult = {
    owner: result.owner,
    stop: result.stop,
    range: { start: guestRange.start, end: guestRange.end },
    reason: result.reason,
    status: result.status,
    diagnostics: result.diagnostics,
  };
  if (!boundedExit(value, entry, start, document.text.length, maxStop))
    return outcome("invalid", "INVALID_GUEST_EXIT", document);
  const copied = diagnosticCopy(value.diagnostics, start, value.stop, entry.guest.languageId);
  if (!copied) return outcome("invalid", "INVALID_GUEST_DIAGNOSTIC", document);
  if (!meter.report(copied.length) || meter.exhausted)
    return outcome("budget", "WORK_OR_DIAGNOSTIC_LIMIT", document);
  if (value.status !== "valid") return outcome(value.status, value.reason, document, copied);
  if (
    value.stop <= start ||
    !document.text.startsWith(entry.profile.close, value.stop) ||
    copied.length ||
    value.reason !== "host-close" ||
    !Number.isSafeInteger(guestWork) ||
    guestWork < 1
  )
    return outcome("invalid", "INVALID_GUEST_EXIT", document);
  const subtree = result.subtree;
  if (subtree === undefined) return outcome("invalid", "MISSING_GUEST_SUBTREE", document);
  if (!meter.charge(entry.profile.close.length))
    return outcome("budget", "WORK_OR_DIAGNOSTIC_LIMIT", document);
  return {
    start,
    stop: value.stop,
    close: entry.profile.close,
    guest: entry.guest.languageId,
    subtree,
  };
}
function processSlot(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
  slot: CompositionSlot,
  cursor: number,
): Accepted | CompositionOutcome {
  const entry = select(slot, request.hostLanguageId, profiles, guests);
  if (!entry) return outcome("unsupported", "UNDECLARED_GUEST_OR_POSITION", document);
  if (!document.text.startsWith(entry.profile.open, slot.start))
    return outcome("invalid", "MISSING_OPEN", document);
  const start = slot.start + entry.profile.open.length;
  if (
    slot.maxStop !== undefined &&
    (!offset(slot.maxStop, document.text.length) || slot.maxStop < start)
  )
    return outcome("invalid", "INVALID_MAX_STOP", document);
  if (!meter.charge(start - cursor) || !meter.enter())
    return outcome("budget", "WORK_OR_DEPTH_LIMIT", document);
  const workBefore = meter.work;
  let result: GuestCompositionResult;
  try {
    result = entry.guest.parse(
      Object.freeze({
        snapshot: document,
        start,
        close: entry.profile.close,
        context:
          slot.context &&
          Object.freeze({
            expectedType: slot.context.expectedType,
            location: slot.context.location,
          }),
        meter,
      }),
    );
  } finally {
    meter.leave();
  }
  const state = checkpoint(request, document);
  if (state) return outcome(state, state, document);
  if (meter.exhausted) return outcome("budget", "GUEST_BUDGET", document);
  const work = meter.work - workBefore;
  const admitted = admit(result, entry, start, document, meter, slot.maxStop, work);
  const afterAdmission = checkpoint(request, document);
  return afterAdmission ? outcome(afterAdmission, afterAdmission, document) : admitted;
}

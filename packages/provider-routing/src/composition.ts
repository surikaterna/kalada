import { Meter } from "./composition-meter.js";
import {
  attempt,
  clearBoundary,
  clearFailure,
  connector,
  type Failure,
  partial,
  recoveryFailure,
} from "./composition-recovery.js";
import {
  boundedExit,
  checkpoint,
  diagnosticCopy,
  id,
  offset,
  outcome,
  profileCopy,
  range,
  snapshot,
} from "./composition-validation.js";
import type {
  CompositionAttempt,
  CompositionDiagnostic,
  CompositionGuest,
  CompositionMeter,
  CompositionNode,
  CompositionOutcome,
  CompositionProfile,
  CompositionRequest,
  CompositionSlot,
  CompositionSnapshot,
  GuestCompositionResult,
} from "./contracts.js";

const MAX_TEXT = 100_000;
const MAX_WORK = 1_000_000;
const MAX_DEPTH = 32;
const MAX_DIAGNOSTICS = 100;
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
  for (const [index, slot] of request.slots.entries()) {
    const state = checkpoint(request, document);
    if (state) return outcome(state, state, document);
    if (!offset(slot?.start, document.text.length) || slot.start < cursor)
      return outcome("invalid", "OVERLAPPING_SLOT", document);
    const processed = processSlot(request, document, meter, profiles, guests, slot, cursor);
    if ("outcome" in processed)
      return walkFailure(request, document, meter, profiles, guests, index, processed);
    const { start, stop, close, guest, subtree } = processed;
    if (!clearBoundary(request, document, index, stop + close.length))
      return outcome("invalid", "OVERLAPPING_SLOT", document);
    if (slot.start > cursor) children.push(node(request.hostLanguageId, cursor, slot.start));
    children.push(node(request.hostLanguageId, slot.start, start));
    children.push(node(guest, start, stop, [], subtree));
    cursor = stop + close.length;
    children.push(node(request.hostLanguageId, stop, cursor));
  }
  return finishWalk(request, document, meter, children, cursor);
}
function walkFailure(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
  index: number,
  failed: Failure,
): CompositionOutcome {
  if (!clearFailure(request, document, index, failed))
    return outcome("invalid", "OVERLAPPING_SLOT", document);
  return failed.safe && request.hostContinuation && index + 1 < request.slots.length
    ? recover(request, document, meter, profiles, guests, index, failed)
    : failed.outcome;
}
function finishWalk(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  children: CompositionNode[],
  cursor: number,
): CompositionOutcome {
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

type Accepted = {
  start: number;
  stop: number;
  close: string;
  profile: CompositionProfile;
  guest: string;
  subtree: unknown;
};
function resumeSlot(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
  slot: CompositionSlot | undefined,
  previous: NonNullable<Failure["safe"]>,
): Accepted | Failure {
  const state = checkpoint(request, document);
  if (state) return { outcome: outcome(state, state, document) };
  if (!slot) return { outcome: outcome("invalid", "MISSING_SLOT", document) };
  const entry = select(slot, request.hostLanguageId, profiles, guests);
  if (!entry || !document.text.startsWith(entry.profile.open, slot.start))
    return { outcome: outcome("invalid", "MISSING_NEXT_OPEN", document) };
  if (!connector(request, document, meter, previous.stop, previous.profile, slot))
    return {
      outcome: outcome(meter.exhausted ? "budget" : "invalid", "CONNECTOR_REJECTED", document),
    };
  const after = checkpoint(request, document);
  if (after) return { outcome: outcome(after, after, document) };
  return processSlot(request, document, meter, profiles, guests, slot, slot.start);
}
function recover(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  profiles: readonly CompositionProfile[],
  guests: ReadonlyMap<string, CompositionGuest>,
  index: number,
  failed: Failure,
): CompositionOutcome {
  const attempts = [failed.attempt as CompositionAttempt];
  const candidates: CompositionNode[] = [];
  let previous = failed.safe as NonNullable<Failure["safe"]>;
  for (let i = index + 1; i < request.slots.length; i++) {
    const slot = request.slots[i];
    const processed = resumeSlot(request, document, meter, profiles, guests, slot, previous);
    if ("outcome" in processed) {
      const decision = recoveryFailure(
        request,
        document,
        i,
        processed,
        attempts,
        candidates,
        failed.outcome.reason,
      );
      if (decision.outcome) return decision.outcome;
      previous = decision.safe as NonNullable<Failure["safe"]>;
      continue;
    }
    if (!clearBoundary(request, document, i, processed.stop + processed.close.length))
      return outcome("invalid", "OVERLAPPING_SLOT", document);
    candidates.push(node(processed.guest, processed.start, processed.stop, [], processed.subtree));
    previous = { stop: processed.stop, profile: processed.profile };
  }
  if (meter.exhausted) return outcome("budget", "WORK_LIMIT", document);
  const state = checkpoint(request, document);
  return state
    ? outcome(state, state, document)
    : partial(document, failed.outcome.reason, attempts, candidates);
}
function admit(
  result: GuestCompositionResult,
  entry: Entry,
  start: number,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  maxStop: number | undefined,
  guestWork: number,
): Accepted | Failure {
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
  if (!boundedExit(value, entry.guest.languageId, start, document.text.length, maxStop))
    return { outcome: outcome("invalid", "INVALID_GUEST_EXIT", document) };
  const copied = diagnosticCopy(value.diagnostics, start, value.stop, entry.guest.languageId);
  if (!copied) return { outcome: outcome("invalid", "INVALID_GUEST_DIAGNOSTIC", document) };
  if (!meter.report(copied.length) || meter.exhausted)
    return { outcome: outcome("budget", "WORK_OR_DIAGNOSTIC_LIMIT", document) };
  if (value.status !== "valid")
    return {
      outcome: outcome(value.status, value.reason, document, copied),
      attempt: attempt(value, copied),
      safe:
        value.status === "partial" &&
        value.reason === "safe-host-close" &&
        value.stop > start &&
        guestWork >= value.stop - start &&
        document.text.startsWith(entry.profile.close, value.stop)
          ? { stop: value.stop, profile: entry.profile }
          : undefined,
    };
  return admitValid(result, value, copied, entry, start, document, meter, guestWork);
}
function admitValid(
  result: GuestCompositionResult,
  value: GuestCompositionResult,
  copied: readonly CompositionDiagnostic[],
  entry: Entry,
  start: number,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  guestWork: number,
): Accepted | Failure {
  if (
    value.stop <= start ||
    !document.text.startsWith(entry.profile.close, value.stop) ||
    copied.length ||
    value.reason !== "host-close" ||
    !Number.isSafeInteger(guestWork) ||
    guestWork < 1
  )
    return { outcome: outcome("invalid", "INVALID_GUEST_EXIT", document) };
  const subtree = result.subtree;
  if (subtree === undefined)
    return { outcome: outcome("invalid", "MISSING_GUEST_SUBTREE", document) };
  if (!meter.charge(entry.profile.close.length))
    return { outcome: outcome("budget", "WORK_OR_DIAGNOSTIC_LIMIT", document) };
  return {
    start,
    stop: value.stop,
    close: entry.profile.close,
    profile: entry.profile,
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
): Accepted | Failure {
  const entry = select(slot, request.hostLanguageId, profiles, guests);
  if (!entry) return { outcome: outcome("unsupported", "UNDECLARED_GUEST_OR_POSITION", document) };
  if (!document.text.startsWith(entry.profile.open, slot.start))
    return { outcome: outcome("invalid", "MISSING_OPEN", document) };
  const start = slot.start + entry.profile.open.length;
  if (
    slot.maxStop !== undefined &&
    (!offset(slot.maxStop, document.text.length) || slot.maxStop < start)
  )
    return { outcome: outcome("invalid", "INVALID_MAX_STOP", document) };
  if (!meter.charge(start - cursor) || !meter.enter())
    return { outcome: outcome("budget", "WORK_OR_DEPTH_LIMIT", document) };
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
  if (state) return { outcome: outcome(state, state, document) };
  if (meter.exhausted) return { outcome: outcome("budget", "GUEST_BUDGET", document) };
  const work = meter.work - workBefore;
  const admitted = admit(result, entry, start, document, meter, slot.maxStop, work);
  const afterAdmission = checkpoint(request, document);
  return afterAdmission ? { outcome: outcome(afterAdmission, afterAdmission, document) } : admitted;
}

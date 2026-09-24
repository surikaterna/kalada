import type { Guest, GuestResult, Meter, Snapshot } from "./host-profile.js";

export type OwnedRange = Readonly<{
  start: number;
  end: number;
  owner: "host" | "tiny" | "kalada";
}>;
export type Attempt = Readonly<{
  slot: 1 | 2;
  start: number;
  stop: number;
  reason: string;
  diagnostics: readonly Readonly<{
    code: string;
    range: Readonly<{ start: number; end: number }>;
  }>[];
}>;
export type Recovery = Readonly<{
  status: "valid" | "partial" | "invalid" | "unsupported" | "budget" | "stale" | "cancelled";
  stop: number | null;
  ranges: readonly OwnedRange[];
  attempts: readonly Attempt[];
  work: number;
  depth: number;
  diagnostics: number;
}>;
export type RecoveryRequest = Readonly<{
  snapshot: Snapshot;
  current: Snapshot;
  cancelled?: boolean;
  meter: Meter;
  guest: Guest;
  owner: "tiny" | "kalada";
}>;

function validReturn(
  guest: GuestResult,
  start: number,
  source: string,
  meter: Meter,
  before: number,
) {
  const { stop, chargedWork = 0 } = guest;
  return (
    Number.isSafeInteger(stop) &&
    stop >= start &&
    stop <= source.length &&
    Number.isSafeInteger(chargedWork) &&
    chargedWork >= 0 &&
    chargedWork <= meter.work - before &&
    chargedWork <= stop - start &&
    guest.range.start === start &&
    guest.range.end === stop &&
    meter.advance(stop - start - chargedWork) &&
    meter.report(guest.diagnostics.length)
  );
}

function exitStatus(
  guest: GuestResult,
  start: number,
  source: string,
  meter: Meter,
): Recovery["status"] | null {
  if (guest.reason === "limit" || meter.exhausted) return "budget";
  if (
    guest.reason.startsWith("unsupported") ||
    guest.diagnostics.some(
      (item: { code?: string }) => item.code === "KALADA_SYNTAX_UNSUPPORTED_FORM",
    )
  )
    return "unsupported";
  if (guest.reason !== "outer-brace" || guest.stop <= start || source[guest.stop] !== "}")
    return "partial";
  if (
    guest.ok &&
    (guest.parsed?.document.source !== source ||
      guest.diagnostics.length !== 0 ||
      guest.parsed.diagnostics.length !== 0)
  )
    return "invalid";
  return null;
}

function invoke(
  request: RecoveryRequest,
  start: number,
): { guest: GuestResult; before: number } | null {
  const { meter } = request;
  if (!meter.enter()) return null;
  const before = meter.work;
  try {
    return { guest: request.guest(request.snapshot.source, start, meter), before };
  } finally {
    meter.leave();
  }
}

type State = { start: number; stop: number | null; ranges: OwnedRange[]; attempts: Attempt[] };

function sameSnapshot(request: RecoveryRequest, admitted: Snapshot): boolean {
  const { snapshot, current } = request;
  return [snapshot, current].every(
    (item) =>
      item.source === admitted.source &&
      item.version === admitted.version &&
      item.environment === admitted.environment,
  );
}

function scanTail(source: string, at: number, meter: Meter): Recovery["status"] | null {
  for (let offset = at; offset < source.length; offset++) {
    if (!meter.advance(1)) return "budget";
    const ch = source[offset];
    if (offset !== at && (ch === "{" || ch === "}")) return "partial";
  }
  return null;
}

function hostSegment(
  request: RecoveryRequest,
  state: State,
  slot: 1 | 2,
): Recovery["status"] | null {
  const { source } = request.snapshot;
  const at = state.stop;
  if (at === null) return "invalid";
  if (slot === 1) {
    for (let offset = 0; offset < 6; offset++) {
      if (!request.meter.advance(1)) return "budget";
      if (source[at + offset] !== "}next{"[offset]) return "partial";
    }
    state.start = at + 6;
    state.ranges.push({ start: at, end: state.start, owner: "host" });
    return null;
  }
  const status = scanTail(source, at, request.meter);
  if (status) return status;
  state.ranges.push({ start: at, end: source.length, owner: "host" });
  return null;
}

function processSlot(
  request: RecoveryRequest,
  admitted: Snapshot,
  state: State,
  slot: 1 | 2,
): Recovery["status"] | null {
  const { meter, snapshot } = request;
  const { start } = state;
  const call = invoke(request, start);
  if (!call) return "budget";
  const { guest, before } = call;
  if (request.cancelled) return "cancelled";
  if (!sameSnapshot(request, admitted)) return "stale";
  if (meter.exhausted || !meter.hasRoom()) return "budget";
  if (!guest || !Array.isArray(guest.diagnostics) || !guest.range) return "invalid";
  if (!validReturn(guest, start, snapshot.source, meter, before))
    return meter.exhausted ? "budget" : "invalid";
  state.attempts.push({
    slot,
    start,
    stop: guest.stop,
    reason: guest.reason,
    diagnostics: guest.diagnostics as Attempt["diagnostics"],
  });
  const exit = exitStatus(guest, start, snapshot.source, meter);
  if (exit) return exit;
  state.stop = guest.stop;
  if (slot === 1) state.ranges.push({ start: 0, end: start, owner: "host" });
  if (guest.ok) state.ranges.push({ start, end: guest.stop, owner: request.owner });
  return hostSegment(request, state, slot);
}

// Only the two literal slots are declared; no search through guest interiors or host tails.
export function recoverHost(request: RecoveryRequest): Recovery {
  const { snapshot, meter } = request;
  const admitted = { ...snapshot };
  const source = snapshot.source;
  const state: State = { start: 0, stop: null, ranges: [], attempts: [] };
  const done = (status: Recovery["status"]): Recovery => ({
    status,
    stop: state.stop,
    ranges: status === "budget" ? [] : state.ranges,
    attempts: state.attempts,
    work: meter.work,
    depth: meter.depth,
    diagnostics: meter.diagnostics,
  });
  if (!sameSnapshot(request, admitted)) return done("stale");
  if (request.cancelled) return done("cancelled");
  const prefix = source.startsWith("🚀\r\n") ? "🚀\r\n" : "";
  if (!source.startsWith("host{", prefix.length)) return done("invalid");
  state.start = prefix.length + 5;
  if (!meter.advance(state.start) || !meter.hasRoom()) return done("budget");

  for (const slot of [1, 2] as const) {
    const status = processSlot(request, admitted, state, slot);
    if (status) return done(status);
  }
  return done(
    state.ranges.filter((item) => item.owner === request.owner).length === 2 ? "valid" : "partial",
  );
}

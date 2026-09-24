import type { GuestBoundaryResult } from "../../packages/syntax/src/guest-boundary.js";
import { parseGuestExpressionPrefix } from "../../packages/syntax/src/guest-boundary.js";

type Status = "valid" | "invalid" | "unsupported" | "partial" | "stale" | "cancelled" | "budget";
type Owner = "host" | "kalada";
type Range = Readonly<{ start: number; end: number; owner: Owner }>;

export type Snapshot = Readonly<{ source: string; version: number; environment: string }>;
export type Profile = Readonly<{
  version: 1;
  position: "expression";
  allowed: readonly string[];
  rootDefault?: string;
}>;
export type Request = Readonly<{
  snapshot: Snapshot;
  current: Snapshot;
  profiles: readonly Profile[];
  explicit?: string;
  cancelled?: boolean;
  budget: Readonly<{ work: number; depth: number; diagnostics: number }>;
  meter?: Meter;
  guest?: (source: string, start: number, meter: Meter) => GuestBoundaryResult;
}>;
export type Outcome = Readonly<{
  status: Status;
  reason: string;
  ranges: readonly Range[];
  stop: number | null;
  guest: GuestBoundaryResult | null;
  work: number;
  depth: number;
  diagnostics: number;
}>;

const openers = ["host{", "🚀\r\nhost{"] as const;

export class Meter {
  work = 0;
  depth = 0;
  diagnostics = 0;
  exhausted = false;
  private active = 0;

  constructor(readonly limits: Request["budget"]) {}

  advance(units: number): boolean {
    if (!Number.isSafeInteger(units) || units < 0 || this.work + units > this.limits.work)
      return this.fail();
    this.work += units;
    return true;
  }

  report(count: number): boolean {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      this.diagnostics + count > this.limits.diagnostics
    )
      return this.fail();
    this.diagnostics += count;
    return true;
  }

  enter(): boolean {
    if (this.active >= this.limits.depth) return this.fail();
    this.active++;
    this.depth = Math.max(this.depth, this.active);
    return true;
  }

  leave(): void {
    this.active--;
  }

  get remainingWork(): number {
    return this.limits.work - this.work;
  }

  get remainingDiagnostics(): number {
    return this.limits.diagnostics - this.diagnostics;
  }

  hasRoom(): boolean {
    if (this.remainingWork < 1 || this.remainingDiagnostics < 1) return this.fail();
    return true;
  }

  private fail(): false {
    this.exhausted = true;
    return false;
  }
}

function entryStart(source: string): number | null {
  const declared = openers.find((item) => source.startsWith(item));
  return declared ? declared.length : null;
}

function outcome(status: Status, reason: string, meter?: Meter): Outcome {
  return Object.freeze({
    status,
    reason,
    ranges: [],
    stop: null,
    guest: null,
    work: meter?.work ?? 0,
    depth: meter?.depth ?? 0,
    diagnostics: meter?.diagnostics ?? 0,
  });
}

// This fixture's host grammar is exactly host{expression} (optionally after 🚀 CRLF)
// followed by brace-free host text; both entry offsets are statically declared.
// It does not discover slots by scanning guest text or claim a general host/FSX parser.
export function compose(request: Request): Outcome {
  const { snapshot, current, budget } = request;
  const meter = request.meter ?? new Meter(budget);
  const admitted = Object.freeze({ ...snapshot });
  if (
    snapshot.version !== current.version ||
    snapshot.environment !== current.environment ||
    snapshot.source !== current.source
  )
    return outcome("stale", "snapshot/environment mismatch");
  if (request.cancelled) return outcome("cancelled", "cancelled before entry");
  const selection = select(request);
  if (selection) return selection;
  const start = entryStart(snapshot.source);
  if (start === null) return outcome("invalid", "undeclared host position");
  if (!meter.advance(start) || !meter.hasRoom() || !meter.enter())
    return outcome("budget", "shared entry budget exhausted", meter);
  let guest: GuestBoundaryResult;
  try {
    guest = request.guest
      ? request.guest(snapshot.source, start, meter)
      : parseGuestExpressionPrefix(snapshot.source, start, {
          limits: {
            maxSourceLength: meter.remainingWork,
            maxDiagnostics: meter.remainingDiagnostics,
          },
        });
  } finally {
    meter.leave();
  }
  if (request.cancelled) return outcome("cancelled", "cancelled after guest return");
  if (!sameIdentity(admitted, request.snapshot) || !sameIdentity(admitted, request.current))
    return outcome("stale", "snapshot/environment changed during guest");
  return acceptGuest(request, guest, start, meter);
}

function sameIdentity(left: Snapshot, right: Snapshot): boolean {
  return (
    left.version === right.version &&
    left.environment === right.environment &&
    left.source === right.source
  );
}

function select(request: Request): Outcome | null {
  const { snapshot } = request;
  if (entryStart(snapshot.source) === null) return outcome("invalid", "undeclared host position");
  if (request.profiles.length !== 1) return outcome("invalid", "overlapping or missing slot");
  const profile = request.profiles[0];
  if (profile?.version !== 1 || profile.position !== "expression")
    return outcome("unsupported", "unknown profile version or position");
  if (new Set(profile.allowed).size !== profile.allowed.length)
    return outcome("invalid", "ambiguous guest registration");
  const selected = request.explicit ?? profile.rootDefault;
  if (!selected) return outcome("unsupported", "explicit guest required");
  if (!profile.allowed.includes(selected) || selected !== "kalada")
    return outcome("unsupported", "forbidden or unsupported guest");
  return null;
}

function acceptGuest(
  request: Request,
  guest: GuestBoundaryResult,
  start: number,
  meter: Meter,
): Outcome {
  const { snapshot } = request;
  const stop = guest.stop;
  const diagnostics = guest.diagnostics.length;
  if (
    meter.exhausted ||
    !meter.advance(Number.isSafeInteger(stop) ? Math.max(0, stop - start) : 0) ||
    !meter.report(diagnostics)
  )
    return outcome("budget", "shared guest budget exhausted", meter);
  if (guest.reason === "unsupported-comment") return outcome("unsupported", guest.reason, meter);
  if (guest.reason === "eof" || guest.reason === "limit")
    return outcome(guest.reason === "limit" ? "budget" : "partial", guest.reason, meter);
  if (!validExit(snapshot.source, guest, start))
    return outcome("invalid", "non-progress, out-of-range or non-delimiter exit", meter);
  if (
    !guest.ok ||
    guest.reason !== "outer-brace" ||
    !guest.parsed ||
    diagnostics !== 0 ||
    guest.parsed.diagnostics.length !== 0
  )
    return outcome("partial", guest.reason, meter);
  if (guest.parsed.document.source !== snapshot.source)
    return outcome("invalid", "guest source identity mismatch", meter);
  if (meter.diagnostics !== 0) return outcome("partial", "nested diagnostic", meter);
  return finishHost(request, guest, start, meter);
}

function validExit(source: string, guest: GuestBoundaryResult, start: number): boolean {
  const stop = guest.stop;
  return (
    Number.isSafeInteger(stop) &&
    stop > start &&
    stop < source.length &&
    guest.range.start === start &&
    guest.range.end === stop &&
    source[stop] === "}"
  );
}

function finishHost(
  request: Request,
  guest: GuestBoundaryResult,
  start: number,
  meter: Meter,
): Outcome {
  const { snapshot } = request;
  const stop = guest.stop;
  const tail = snapshot.source.slice(stop + 1);
  if (/[{}]/u.test(tail)) return outcome("invalid", "malformed host sibling", meter);
  if (!meter.advance(1 + tail.length))
    return outcome("budget", "shared host continuation budget exhausted", meter);
  return Object.freeze({
    status: "valid",
    reason: "complete",
    stop,
    guest,
    work: meter.work,
    depth: meter.depth,
    diagnostics: meter.diagnostics,
    ranges: Object.freeze([
      Object.freeze({ start: 0, end: start, owner: "host" as const }),
      Object.freeze({ start, end: stop, owner: "kalada" as const }),
      Object.freeze({ start: stop, end: snapshot.source.length, owner: "host" as const }),
    ]),
  });
}

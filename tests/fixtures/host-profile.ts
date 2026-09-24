type Status = "valid" | "invalid" | "unsupported" | "partial" | "stale" | "cancelled" | "budget";
type Owner = "host" | string;
type Range = Readonly<{ start: number; end: number; owner: Owner }>;
export type GuestResult = Readonly<{
  ok: boolean;
  // Cooperative guests report already-metered scan work so the host does not debit it twice.
  chargedWork?: number;
  stop: number;
  range: Readonly<{ start: number; end: number }>;
  reason: string;
  diagnostics: readonly unknown[];
  parsed: null | Readonly<{
    document: Readonly<{ source: string }>;
    diagnostics: readonly unknown[];
  }>;
}>;
export type Guest = (source: string, start: number, meter: Meter) => GuestResult;

export type Snapshot = Readonly<{ source: string; version: number; environment: string }>;
export type Profile = Readonly<{
  version: 1;
  position: "expression" | "reverse";
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
  guests?: Readonly<Record<string, Guest>>;
}>;
export type Outcome = Readonly<{
  status: Status;
  reason: string;
  ranges: readonly Range[];
  stop: number | null;
  guest: GuestResult | null;
  work: number;
  depth: number;
  diagnostics: number;
}>;

const openers = { expression: ["host{", "🚀\r\nhost{"], reverse: ["tiny<host{"] } as const;

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

  get activeDepth(): number {
    return this.active;
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

function entryStart(source: string, position: Profile["position"]): number | null {
  const declared = openers[position].find((item) => source.startsWith(item));
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
  if (!sameIdentity(snapshot, current)) return outcome("stale", "snapshot/environment mismatch");
  if (request.cancelled) return outcome("cancelled", "cancelled before entry");
  const selection = select(request);
  if (selection instanceof Object && "status" in selection) return selection;
  const start = entryStart(snapshot.source, request.profiles[0].position);
  if (start === null) return outcome("invalid", "undeclared host position");
  const parser = resolveGuest(request, selection);
  if (!parser) return outcome("unsupported", "unregistered guest");
  if (!meter.advance(start) || !meter.hasRoom() || !meter.enter())
    return outcome("budget", "shared entry budget exhausted", meter);
  let guest: GuestResult;
  const before = {
    work: meter.work,
    diagnostics: meter.diagnostics,
    depth: meter.depth,
    active: meter.activeDepth,
  };
  try {
    guest = parser(snapshot.source, start, meter);
  } finally {
    meter.leave();
  }
  if (request.cancelled) return outcome("cancelled", "cancelled after guest return");
  if (!sameIdentity(admitted, request.snapshot) || !sameIdentity(admitted, request.current))
    return outcome("stale", "snapshot/environment changed during guest");
  if (spoofed(meter, before)) return outcome("budget", "spoofed or exhausted meter", meter);
  return acceptGuest(request, guest, start, selection, meter, before.work);
}

function resolveGuest(request: Request, selected: string): Guest | null {
  const guests = request.guests;
  if (!guests) return null;
  // Resolve one own data entry once; never invoke a getter or consult a fallback parser.
  const entry = Object.getOwnPropertyDescriptor(guests, selected);
  return entry && "value" in entry && typeof entry.value === "function" ? entry.value : null;
}

function spoofed(
  meter: Meter,
  before: { work: number; diagnostics: number; depth: number; active: number },
): boolean {
  return (
    meter.exhausted ||
    !meter.hasRoom() ||
    meter.work < before.work ||
    meter.diagnostics < before.diagnostics ||
    meter.depth < before.depth ||
    meter.activeDepth !== before.active - 1 ||
    meter.depth > meter.limits.depth ||
    meter.work > meter.limits.work ||
    meter.diagnostics > meter.limits.diagnostics
  );
}

function sameIdentity(left: Snapshot, right: Snapshot): boolean {
  return (
    left.version === right.version &&
    left.environment === right.environment &&
    left.source === right.source
  );
}

function select(request: Request): Outcome | string {
  const { snapshot } = request;
  if (request.profiles.length !== 1) return outcome("invalid", "overlapping or missing slot");
  const profile = request.profiles[0];
  if (profile?.version !== 1 || !Object.hasOwn(openers, profile.position))
    return outcome("unsupported", "unknown profile version or position");
  if (entryStart(snapshot.source, profile.position) === null)
    return outcome("invalid", "undeclared host position");
  if (new Set(profile.allowed).size !== profile.allowed.length)
    return outcome("invalid", "ambiguous guest registration");
  const selected = request.explicit ?? profile.rootDefault;
  if (!selected) return outcome("unsupported", "explicit guest required");
  if (!profile.allowed.includes(selected))
    return outcome("unsupported", "forbidden or unsupported guest");
  return selected;
}

function acceptGuest(
  request: Request,
  guest: GuestResult,
  start: number,
  selected: string,
  meter: Meter,
  startWork: number,
): Outcome {
  const { snapshot } = request;
  if (!guest?.range || !Array.isArray(guest.diagnostics))
    return outcome("invalid", "non-progress, out-of-range or non-delimiter exit", meter);
  const stop = guest.stop;
  const diagnostics = guest.diagnostics.length;
  if (!accountGuest(meter, stop, start, diagnostics, guest.chargedWork ?? 0, startWork))
    return outcome("budget", "shared guest budget exhausted", meter);
  if (guest.reason === "unsupported-comment" || guest.reason === "unsupported-token")
    return outcome("unsupported", guest.reason, meter);
  if (guest.reason === "eof" || guest.reason === "limit")
    return outcome(guest.reason === "limit" ? "budget" : "partial", guest.reason, meter);
  if (!validExit(snapshot.source, guest, start))
    return outcome("invalid", "non-progress, out-of-range or non-delimiter exit", meter);
  if (!cleanGuest(guest)) return outcome("partial", guest.reason, meter);
  if (guest.parsed.document.source !== snapshot.source)
    return outcome("invalid", "guest source identity mismatch", meter);
  if (meter.diagnostics !== 0) return outcome("partial", "nested diagnostic", meter);
  return finishHost(request, guest, start, selected, meter);
}

function accountGuest(
  meter: Meter,
  stop: number,
  start: number,
  count: number,
  charged: number,
  startWork: number,
): boolean {
  return (
    !meter.exhausted &&
    Number.isSafeInteger(charged) &&
    charged >= 0 &&
    charged <= meter.work - startWork &&
    charged <= stop - start &&
    meter.advance(Number.isSafeInteger(stop) ? Math.max(0, stop - start - charged) : 0) &&
    meter.report(count)
  );
}

function cleanGuest(guest: GuestResult): boolean {
  return (
    guest.ok &&
    guest.reason === "outer-brace" &&
    !!guest.parsed &&
    guest.diagnostics.length === 0 &&
    guest.parsed.diagnostics.length === 0
  );
}

function validExit(source: string, guest: GuestResult, start: number): boolean {
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
  guest: GuestResult,
  start: number,
  selected: string,
  meter: Meter,
): Outcome {
  const { snapshot } = request;
  const stop = guest.stop;
  const tail = snapshot.source.slice(stop + 1);
  if (request.profiles[0].position === "reverse" && !tail.startsWith(">"))
    return outcome("invalid", "reverse host close missing", meter);
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
      Object.freeze({ start, end: stop, owner: selected }),
      Object.freeze({ start: stop, end: snapshot.source.length, owner: "host" as const }),
    ]),
  });
}

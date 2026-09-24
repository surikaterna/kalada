import { lowerKaladaV1Expression } from "../../packages/syntax/src/lower.js";
import type { KaladaLowerOutcome } from "../../packages/syntax/src/public-types.js";
import { compose, type GuestResult, Meter, type Outcome, type Snapshot } from "./host-profile.js";
import { kaladaGuest } from "./kalada-guest.js";

export type Phase =
  | "captured"
  | "dispatch-requested"
  | "guest returned"
  | "host validated"
  | "phase admitted"
  | "lowerable"
  | "publishable";

export type Counters = { lower: number; emit: number; edit: number };
export type Probe = {
  snapshot: Snapshot;
  current: Snapshot;
  cancelled?: boolean;
  meter?: Meter;
  onReturn?: (result: GuestResult, probe: Probe) => GuestResult;
};

// The trusted parse is created in this synchronous request, not reconstructed from a CST.
// The callback is cooperative test machinery, not a hostile-code sandbox.
export function admitPhase(probe: Probe) {
  const phases: Phase[] = ["captured"];
  const counters: Counters = { lower: 0, emit: 0, edit: 0 };
  const captured = { ...probe.snapshot };
  const same = (value: Snapshot) =>
    value.source === captured.source &&
    value.version === captured.version &&
    value.environment === captured.environment;
  if (same(probe.snapshot) && same(probe.current) && !probe.cancelled)
    phases.push("dispatch-requested");
  const { outcome, authentic } = dispatch(probe, phases);
  const validated = validatedReturn(outcome, probe, same);
  if (validated) phases.push("host validated");
  let lowered: KaladaLowerOutcome | null = null;
  if (validated && authentic && outcome.guest?.parsed) {
    phases.push("phase admitted");
    counters.lower++;
    lowered = lowerKaladaV1Expression(outcome.guest.parsed);
    if (lowered.ok) {
      phases.push("lowerable", "publishable");
      counters.emit++;
      counters.edit++;
    }
  }
  return { phases, counters, outcome, lowered, authentic };
}

function dispatch(probe: Probe, phases: Phase[]) {
  const suppliedMeter = probe.meter;
  const meter = suppliedMeter ?? new Meter({ work: 512, depth: 1, diagnostics: 3 });
  const entryMeter = meterState(meter);
  let authentic = false;
  let meterTampered = false;
  const composed = validMeter(meter)
    ? composeSafely({
        snapshot: probe.snapshot,
        current: probe.current,
        get cancelled() {
          return probe.cancelled;
        },
        profiles: [{ version: 1, position: "expression", allowed: ["kalada"] }],
        explicit: "kalada",
        budget: { work: 512, depth: 1, diagnostics: 3 },
        meter,
        guests: {
          kalada: (source, start, meter) => {
            const trusted = kaladaGuest(source, start, meter);
            const beforeCallback = meterState(meter);
            const returned = Object.hasOwn(probe, "onReturn")
              ? probe.onReturn?.(trusted, probe)
              : trusted;
            if (!sameMeter(meterState(meter), beforeCallback) || probe.meter !== suppliedMeter)
              meterTampered = true;
            authentic = returned === trusted;
            phases.push("guest returned");
            return returned;
          },
        },
      })
    : invalidMeter();
  const outcome =
    meterTampered ||
    (composed.status === "valid" && !validMeter(meter)) ||
    !sameLimits(meterState(meter), entryMeter) ||
    probe.meter !== suppliedMeter ||
    (composed.status === "valid" &&
      (composed.work !== meter.work ||
        composed.depth !== meter.depth ||
        composed.diagnostics !== meter.diagnostics))
      ? invalidMeter()
      : composed;
  return { outcome, authentic };
}

type MeterState = ReturnType<typeof meterState>;

function meterState(meter: Meter) {
  return {
    limits: meter.limits,
    workLimit: meter.limits.work,
    depthLimit: meter.limits.depth,
    diagnosticsLimit: meter.limits.diagnostics,
    work: meter.work,
    depth: meter.depth,
    diagnostics: meter.diagnostics,
    active: meter.activeDepth,
    exhausted: meter.exhausted,
  };
}

function sameLimits(left: MeterState, right: MeterState) {
  return (
    left.limits === right.limits &&
    left.workLimit === right.workLimit &&
    left.depthLimit === right.depthLimit &&
    left.diagnosticsLimit === right.diagnosticsLimit
  );
}

function sameMeter(left: MeterState, right: MeterState) {
  return (
    sameLimits(left, right) &&
    left.work === right.work &&
    left.depth === right.depth &&
    left.diagnostics === right.diagnostics &&
    left.active === right.active &&
    left.exhausted === right.exhausted
  );
}

function validMeter(meter: Meter) {
  const state = meterState(meter);
  return (
    [state.workLimit, state.depthLimit, state.diagnosticsLimit].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
    [
      [state.work, state.workLimit],
      [state.depth, state.depthLimit],
      [state.diagnostics, state.diagnosticsLimit],
    ].every(([value, limit]) => Number.isSafeInteger(value) && value >= 0 && value <= limit) &&
    state.active === 0 &&
    state.exhausted === false
  );
}

function invalidMeter(): Outcome {
  return {
    status: "budget",
    reason: "invalid or mutated shared meter",
    ranges: [],
    stop: null,
    guest: null,
    work: 0,
    depth: 0,
    diagnostics: 0,
  };
}

function composeSafely(request: Parameters<typeof compose>[0]): Outcome {
  try {
    return compose(request);
  } catch {
    return {
      status: "invalid",
      reason: "guest callback failed",
      ranges: [],
      stop: null,
      guest: null,
      work: 0,
      depth: 0,
      diagnostics: 0,
    };
  }
}

function validatedReturn(outcome: Outcome, probe: Probe, same: (value: Snapshot) => boolean) {
  const owned = outcome.ranges[1];
  return (
    outcome.status === "valid" &&
    !probe.cancelled &&
    same(probe.snapshot) &&
    same(probe.current) &&
    owned?.owner === "kalada" &&
    owned.start === outcome.guest?.range.start &&
    owned.end === outcome.guest.stop &&
    outcome.ranges[2]?.start === outcome.stop
  );
}

export function admissionProbe(source: string): Probe {
  const snapshot = { source, version: 1, environment: "fixture" };
  return { snapshot, current: snapshot };
}

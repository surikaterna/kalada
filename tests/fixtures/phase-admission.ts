import { lowerKaladaV1Expression } from "../../packages/syntax/src/lower.js";
import type { KaladaLowerOutcome } from "../../packages/syntax/src/public-types.js";
import {
  compose,
  type GuestResult,
  type Meter,
  type Outcome,
  type Snapshot,
} from "./host-profile.js";
import { kaladaGuest } from "./kalada-guest.js";

export type Phase =
  | "captured"
  | "selected"
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
  let authentic = false;
  const same = (value: Snapshot) =>
    value.source === captured.source &&
    value.version === captured.version &&
    value.environment === captured.environment;
  if (same(probe.snapshot) && same(probe.current) && !probe.cancelled) phases.push("selected");
  const outcome = composeSafely({
    snapshot: probe.snapshot,
    current: probe.current,
    get cancelled() {
      return probe.cancelled;
    },
    profiles: [{ version: 1, position: "expression", allowed: ["kalada"] }],
    explicit: "kalada",
    budget: { work: 512, depth: 1, diagnostics: 3 },
    meter: probe.meter,
    guests: {
      kalada: (source, start, meter) => {
        const trusted = kaladaGuest(source, start, meter);
        const returned = Object.hasOwn(probe, "onReturn")
          ? probe.onReturn?.(trusted, probe)
          : trusted;
        authentic = returned === trusted;
        phases.push("guest returned");
        return returned;
      },
    },
  });
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

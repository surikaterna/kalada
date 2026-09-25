import { declaredSlotsClear, outcome } from "./composition-validation.js";
import type {
  CompositionAttempt,
  CompositionDiagnostic,
  CompositionMeter,
  CompositionNode,
  CompositionOutcome,
  CompositionProfile,
  CompositionRequest,
  CompositionSlot,
  CompositionSnapshot,
  GuestCompositionResult,
} from "./contracts.js";

export type Failure = {
  outcome: CompositionOutcome;
  attempt?: CompositionAttempt;
  safe?: { stop: number; profile: CompositionProfile };
};
export function clearBoundary(
  request: CompositionRequest,
  document: CompositionSnapshot,
  index: number,
  end: number,
): boolean {
  return declaredSlotsClear(request.slots, index, end, document.text.length);
}
export function clearFailure(
  request: CompositionRequest,
  document: CompositionSnapshot,
  index: number,
  failed: Failure,
): boolean {
  if (!failed.attempt) return true;
  const end = failed.safe
    ? failed.safe.stop + failed.safe.profile.close.length
    : failed.attempt.range.end;
  return clearBoundary(request, document, index, end);
}
export function recoveryFailure(
  request: CompositionRequest,
  document: CompositionSnapshot,
  index: number,
  failed: Failure,
  attempts: CompositionAttempt[],
  candidates: CompositionNode[],
  reason: string,
): { outcome?: CompositionOutcome; safe?: Failure["safe"] } {
  if (["budget", "stale", "cancelled"].includes(failed.outcome.status))
    return { outcome: failed.outcome };
  if (!clearFailure(request, document, index, failed))
    return { outcome: outcome("invalid", "OVERLAPPING_SLOT", document) };
  if (failed.attempt) attempts.push(failed.attempt);
  if (failed.safe && index + 1 < request.slots.length) return { safe: failed.safe };
  return { outcome: partial(document, reason, attempts, candidates) };
}

export function attempt(
  result: GuestCompositionResult,
  diagnostics: readonly CompositionDiagnostic[],
): CompositionAttempt {
  return Object.freeze({
    owner: result.owner,
    range: Object.freeze({ start: result.range.start, end: result.stop }),
    status: result.status,
    reason: result.reason,
    diagnostics,
  });
}

export function partial(
  document: CompositionSnapshot,
  reason: string,
  attempts: readonly CompositionAttempt[],
  candidates: readonly CompositionNode[],
): CompositionOutcome {
  return Object.freeze({
    status: "partial",
    reason,
    snapshot: document,
    diagnostics: Object.freeze(attempts.flatMap((item) => item.diagnostics)),
    attempts: Object.freeze([...attempts]),
    candidates: Object.freeze([...candidates]),
  });
}

/** The host callback certifies only its own connector, never the guest interior. */
function connectorInput(
  document: CompositionSnapshot,
  meter: CompositionMeter,
  stop: number,
  start: number,
  next: CompositionSlot,
) {
  return Object.freeze({
    snapshot: document,
    close: Object.freeze({ start: stop, end: start }),
    nextSlot: Object.freeze({
      position: next.position,
      start: next.start,
      maxStop: next.maxStop,
      explicitGuest: next.explicitGuest,
    }),
    meter,
  });
}
export function connector(
  request: CompositionRequest,
  document: CompositionSnapshot,
  meter: CompositionMeter,
  stop: number,
  profile: CompositionProfile,
  next: CompositionSlot,
): boolean {
  const continuation = request.hostContinuation;
  const start = stop + profile.close.length;
  if (
    !continuation ||
    typeof continuation.validate !== "function" ||
    !Number.isSafeInteger(next?.start) ||
    next.start < start ||
    next.start > document.text.length
  )
    return false;
  if (!meter.charge(profile.close.length) || !meter.enter()) return false;
  let value: ReturnType<typeof continuation.validate>;
  const before = meter.work;
  try {
    value = continuation.validate(connectorInput(document, meter, stop, start, next));
  } finally {
    meter.leave();
  }
  const owner = value?.owner;
  const range = value?.range;
  const from = range?.start;
  const to = range?.end;
  return (
    !meter.exhausted &&
    owner === request.hostLanguageId &&
    from === start &&
    to === next.start &&
    meter.work - before >= to - from
  );
}

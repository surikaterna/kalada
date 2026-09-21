import type { KaladaValue } from "@kalada/core";
import type { LiveCapability, ProvenanceEntry } from "./contracts.js";
import type { CompiledExpression, HostLinkPlanSlot, HostResult } from "./execution-contracts.js";
import { coreDiagnostic, executionDiagnostic } from "./execution-diagnostics.js";
import {
  canonicalValue,
  isThenableWithoutGet,
  matchesSemanticType,
  readOwnValue,
} from "./runtime-value.js";

export interface InternalLinkSlot {
  readonly plan: HostLinkPlanSlot;
  readonly validator?: Extract<LiveCapability, { kind: "validator" }>;
  readonly codec?: Extract<LiveCapability, { kind: "codec" }>;
  readonly provenance?: ProvenanceEntry;
}

export function evaluateLinked(
  compiled: CompiledExpression,
  slots: readonly InternalLinkSlot[],
  values: unknown,
): HostResult<KaladaValue> {
  const bound = new Map<string, KaladaValue>();
  for (const slot of slots) {
    const result = bindSlot(slot, values);
    if (!result.ok) return result;
    bound.set(slot.plan.bindingId, result.value);
  }
  const outcome = compiled.coreCompilation.evaluate((reference) =>
    bound.has(reference)
      ? Object.freeze({ found: true as const, value: bound.get(reference) as KaladaValue })
      : Object.freeze({ found: false as const, reason: "missing" as const }),
  );
  if (!outcome.ok) {
    return failure(
      coreDiagnostic("evaluate", outcome.diagnostic, compiled.source, compiled.sourceMap),
    );
  }
  return Object.freeze({ ok: true, value: outcome.value });
}

function bindSlot(slot: InternalLinkSlot, values: unknown): HostResult<KaladaValue> {
  const input = readOwnValue(values, slot.plan.name);
  if (!input.ok) return bindingFailure("HOST_BINDING_MISSING", slot);
  const decoded = invokeValidator(slot, input.value);
  if (!decoded.ok) return decoded;
  const converted = invokeCodec(slot, decoded.value);
  if (!converted.ok) return converted;
  const canonical = canonicalValue(converted.value);
  if (!canonical.ok || !matchesSemanticType(canonical.value, slot.plan.semanticType)) {
    return bindingFailure("HOST_BINDING_SEMANTIC", slot);
  }
  return Object.freeze({ ok: true, value: canonical.value });
}

function invokeValidator(slot: InternalLinkSlot, value: unknown): HostResult<unknown> {
  if (!slot.validator) return Object.freeze({ ok: true, value });
  try {
    const output = slot.validator.decode(value);
    return isThenableWithoutGet(output)
      ? bindingFailure("HOST_BINDING_DECODE", slot)
      : Object.freeze({ ok: true, value: output });
  } catch {
    return bindingFailure("HOST_BINDING_DECODE", slot);
  }
}

function invokeCodec(slot: InternalLinkSlot, value: unknown): HostResult<unknown> {
  if (!slot.codec) return Object.freeze({ ok: true, value });
  try {
    const output = slot.codec.convert(value);
    return isThenableWithoutGet(output)
      ? bindingFailure("HOST_BINDING_CONVERSION", slot)
      : Object.freeze({ ok: true, value: output });
  } catch {
    return bindingFailure("HOST_BINDING_CONVERSION", slot);
  }
}

function bindingFailure(
  code:
    | "HOST_BINDING_MISSING"
    | "HOST_BINDING_DECODE"
    | "HOST_BINDING_CONVERSION"
    | "HOST_BINDING_SEMANTIC",
  slot: InternalLinkSlot,
) {
  return failure(executionDiagnostic(code, "bind", slot.plan.path, slot.provenance));
}

function failure(diagnostic: ReturnType<typeof executionDiagnostic>) {
  return Object.freeze({ ok: false as const, diagnostics: Object.freeze([diagnostic]) });
}

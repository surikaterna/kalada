import { capabilitySnapshotMatches } from "./capability-snapshot.js";
import { isAuthenticCompiledExpression } from "./compiled-artifact.js";
import type {
  CapabilityDeclaration,
  CapabilitySnapshot,
  LiveCapability,
  NormalizedBinding,
  NormalizedEnvironment,
} from "./contracts.js";
import { evaluateLinked, type InternalLinkSlot } from "./evaluate-expression.js";
import type {
  CompiledExpression,
  HostLinkPlanSlot,
  LinkExpressionResult,
} from "./execution-contracts.js";
import { executionDiagnostic } from "./execution-diagnostics.js";
import { createFingerprint, HOST_LINK_FINGERPRINT_VERSION } from "./fingerprint.js";

export function linkExpression(
  compiled: CompiledExpression,
  environment: NormalizedEnvironment,
  snapshot: CapabilitySnapshot,
): LinkExpressionResult {
  try {
    if (!isAuthenticCompiledExpression(compiled)) return incompatible();
    if (!compatibleProjection(compiled, environment)) return incompatible();
    if (!capabilitySnapshotMatches(snapshot, environment)) return invalidSnapshot();
    if (environment.provider.mode === "async") return asyncUnsupported();
    const slots: InternalLinkSlot[] = [];
    for (const dependency of compiled.dependencies) {
      const binding = environment.bindings.find(({ id }) => id === dependency);
      if (!binding) return missingBinding();
      const linked = linkSlot(binding, slots.length, snapshot);
      if (!linked.ok) return linked.result;
      slots.push(linked.slot);
    }
    return linkedArtifact(compiled, environment, slots);
  } catch {
    return incompatible();
  }
}

function linkSlot(
  binding: NormalizedBinding,
  index: number,
  snapshot: CapabilitySnapshot,
):
  | Readonly<{ ok: true; slot: InternalLinkSlot }>
  | Readonly<{ ok: false; result: LinkExpressionResult }> {
  if (binding.validator?.mode === "async" || binding.codec?.mode === "async") {
    return Object.freeze({ ok: false, result: asyncUnsupported(binding) });
  }
  const validator = resolveCapability(binding.validator, snapshot);
  const codec = resolveCapability(binding.codec, snapshot);
  if (
    validator === null ||
    codec === null ||
    (validator && validator.kind !== "validator") ||
    (codec && codec.kind !== "codec")
  ) {
    return Object.freeze({ ok: false, result: invalidCapability(binding) });
  }
  const plan = createPlan(binding, index);
  return Object.freeze({
    ok: true,
    slot: Object.freeze({ plan, validator, codec, provenance: binding.provenance[0] }),
  });
}

function resolveCapability(
  declaration: CapabilityDeclaration | undefined,
  snapshot: CapabilitySnapshot,
): LiveCapability | undefined | null {
  if (!declaration) return undefined;
  if (snapshot.scope !== "instance") return null;
  const descriptor = Object.getOwnPropertyDescriptor(snapshot.capabilities, declaration.handle);
  if (!descriptor || !("value" in descriptor)) return null;
  const live = descriptor.value as LiveCapability;
  if (!sameDeclaration(live, declaration)) return null;
  if (live.kind === "validator" && typeof live.decode !== "function") return null;
  if (live.kind === "codec" && typeof live.convert !== "function") return null;
  return live;
}

function sameDeclaration(live: LiveCapability, expected: CapabilityDeclaration): boolean {
  return (
    live.handle === expected.handle &&
    live.kind === expected.kind &&
    live.mode === expected.mode &&
    live.capabilityId === expected.capabilityId &&
    live.capabilityVersion === expected.capabilityVersion &&
    live.configurationDigest === expected.configurationDigest &&
    JSON.stringify(live.identity) === JSON.stringify(expected.identity)
  );
}

function createPlan(binding: NormalizedBinding, index: number): HostLinkPlanSlot {
  return Object.freeze({
    index,
    bindingId: binding.id,
    name: binding.name,
    path: Object.freeze([...binding.path]),
    semanticType: binding.semanticType,
    ...(binding.validator ? { validator: binding.validator } : {}),
    ...(binding.codec ? { codec: binding.codec } : {}),
  });
}

function linkedArtifact(
  compiled: CompiledExpression,
  environment: NormalizedEnvironment,
  slots: readonly InternalLinkSlot[],
): LinkExpressionResult {
  const internal = Object.freeze([...slots]);
  const linkPlan = Object.freeze(slots.map(({ plan }) => plan));
  const linkFingerprint = reusable(environment)
    ? createFingerprint(
        HOST_LINK_FINGERPRINT_VERSION,
        linkFingerprintInput(compiled, environment, linkPlan),
      )
    : undefined;
  const evaluate = Object.freeze((values: unknown) => evaluateLinked(compiled, internal, values));
  const prepared = Object.freeze({
    format: "kalada-host-prepared-expression-v1" as const,
    compiled,
    environment,
    linkPlan,
    ...(linkFingerprint ? { linkFingerprint } : {}),
    evaluate,
  });
  return Object.freeze({ ok: true, value: prepared });
}

function compatibleProjection(
  compiled: CompiledExpression,
  environment: NormalizedEnvironment,
): boolean {
  if (compiled.format !== "kalada-host-compiled-expression-v1") return false;
  if (environment.format !== "kalada-host-environment-v1") return false;
  return (
    compiled.compileProjectionFingerprint ===
    createFingerprint(environment.compileProjection.format, environment.compileProjection)
  );
}

function reusable(environment: NormalizedEnvironment): boolean {
  return environment.cacheability.cacheable;
}

function linkFingerprintInput(
  compiled: CompiledExpression,
  environment: NormalizedEnvironment,
  linkPlan: readonly HostLinkPlanSlot[],
) {
  return {
    compileFingerprint: compiled.compileFingerprint,
    provider: environment.provider.identity,
    bindings: environment.bindings.map(({ id, name, path, editorShapeRoot, validator, codec }) => ({
      id,
      name,
      path,
      editorShapeRoot,
      validator,
      codec,
    })),
    editorGraph: environment.editorGraph,
    linkPlan,
  };
}

function incompatible(): LinkExpressionResult {
  return failure(executionDiagnostic("HOST_LINK_INCOMPATIBLE_ENVIRONMENT", "link"));
}

function missingBinding(): LinkExpressionResult {
  return failure(executionDiagnostic("HOST_LINK_MISSING_BINDING", "link"));
}

function invalidCapability(binding: NormalizedBinding): LinkExpressionResult {
  return failure(bindingDiagnostic("HOST_LINK_INVALID_CAPABILITY", binding));
}

function invalidSnapshot(): LinkExpressionResult {
  return failure(executionDiagnostic("HOST_LINK_INVALID_CAPABILITY", "link"));
}

function asyncUnsupported(binding?: NormalizedBinding): LinkExpressionResult {
  return failure(
    binding
      ? bindingDiagnostic("HOST_LINK_ASYNC_UNSUPPORTED", binding)
      : executionDiagnostic("HOST_LINK_ASYNC_UNSUPPORTED", "link"),
  );
}

function bindingDiagnostic(
  code: "HOST_LINK_INVALID_CAPABILITY" | "HOST_LINK_ASYNC_UNSUPPORTED",
  binding: NormalizedBinding,
) {
  return executionDiagnostic(code, "link", binding.path, binding.provenance[0]);
}

function failure(diagnostic: ReturnType<typeof executionDiagnostic>): LinkExpressionResult {
  return Object.freeze({ ok: false, diagnostics: Object.freeze([diagnostic]) });
}

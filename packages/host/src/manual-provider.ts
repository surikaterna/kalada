import { type BindingState, normalizeBindings } from "./binding-normalization.js";
import { type CapabilityState, normalizeCapabilities } from "./capability-normalization.js";
import type {
  Cacheability,
  CapabilityDeclaration,
  CapabilitySnapshot,
  DescribeEnvironmentResult,
  HostEnvironmentDiagnostic,
  HostEnvironmentDiagnosticCode,
  ManualProvider,
  ManualProviderInput,
  ProvenanceEntry,
} from "./contracts.js";
import { environmentDiagnostic } from "./diagnostics.js";
import { createEditorGraph } from "./editor-graph.js";
import { normalizeIdentity } from "./identity.js";
import { readOwnDataRecord } from "./serializable.js";

const manualProviderBrand = Symbol("@kalada/host/manual-provider");
type BrandedManualProvider = ManualProvider & { readonly [manualProviderBrand]: true };

export function createManualProvider(input: ManualProviderInput): ManualProvider {
  const outcome = safelyNormalize(input);
  return Object.freeze({
    kind: "manual",
    [manualProviderBrand]: true,
    describe: () => outcome,
  });
}

export function describeEnvironment(provider: ManualProvider): DescribeEnvironmentResult {
  try {
    const candidate = provider as BrandedManualProvider;
    if (candidate?.kind !== "manual" || candidate[manualProviderBrand] !== true) {
      return providerFailure();
    }
    return candidate.describe();
  } catch {
    return providerFailure();
  }
}

export function normalizeManualEnvironment(input: ManualProviderInput): DescribeEnvironmentResult {
  return safelyNormalize(input);
}

function safelyNormalize(input: unknown): DescribeEnvironmentResult {
  try {
    return normalize(input);
  } catch {
    return providerFailure();
  }
}

function normalize(input: unknown): DescribeEnvironmentResult {
  const inspected = readOwnDataRecord(input, 16);
  if (!inspected.ok) return providerFailure();
  const record = inspected.value;
  if (record.mode !== "sync" && record.mode !== "async") return providerFailure();
  const providerIdentity = normalizeProviderIdentity(record);
  if (!providerIdentity) return failure("HOST_ENVIRONMENT_INVALID_IDENTITY");
  const capabilities = normalizeCapabilities(record.capabilities, providerIdentity);
  const bindings = normalizeBindings(record.bindings, capabilities, providerProvenance(record));
  const diagnostics = [...capabilities.diagnostics, ...bindings.diagnostics];
  if (diagnostics.length > 0) return failedDiagnostics(diagnostics);
  return success(record, providerIdentity, capabilities, bindings);
}

function normalizeProviderIdentity(record: Record<string, unknown>): Cacheability | null {
  const result = normalizeIdentity({
    id: record.providerId,
    version: record.providerVersion,
    configurationDigest: record.configurationDigest,
    cacheable: record.cacheable,
  });
  return result.ok ? result.value : null;
}

function providerProvenance(record: Record<string, unknown>): ProvenanceEntry {
  return Object.freeze({
    providerId: typeof record.providerId === "string" ? record.providerId : "manual",
    ...(typeof record.providerVersion === "string"
      ? { providerVersion: record.providerVersion }
      : {}),
  });
}

function success(
  providerRecord: Record<string, unknown>,
  providerIdentity: Cacheability,
  capabilities: CapabilityState,
  bindings: BindingState,
): DescribeEnvironmentResult {
  const graph = createEditorGraph(bindings.graphInputs);
  const roots = new Map(graph.roots.map((root) => [root.bindingId, root.nodeId]));
  const normalized = bindings.bindings.map((binding) =>
    Object.freeze({
      ...binding,
      ...(roots.has(binding.id) ? { editorShapeRoot: roots.get(binding.id) } : {}),
    }),
  );
  const snapshot: CapabilitySnapshot = Object.freeze({
    scope: "instance",
    capabilities: Object.freeze(capabilities.live),
  });
  return Object.freeze({
    ok: true,
    environment: Object.freeze({
      format: "kalada-host-environment-v1",
      provider: providerDeclaration(providerRecord, providerIdentity),
      cacheability: environmentCacheability(providerIdentity, capabilities.declarations),
      bindings: Object.freeze(normalized),
      capabilities: Object.freeze(capabilities.declarations),
      editorGraph: graph,
    }),
    capabilitySnapshot: snapshot,
  });
}

function providerDeclaration(record: Record<string, unknown>, identity: Cacheability) {
  return Object.freeze({
    mode: record.mode as "sync" | "async",
    ...(record.providerId ? { providerId: record.providerId as string } : {}),
    ...(record.providerVersion ? { providerVersion: record.providerVersion as string } : {}),
    ...(record.configurationDigest
      ? { configurationDigest: record.configurationDigest as string }
      : {}),
    identity,
  });
}

function environmentCacheability(
  provider: Cacheability,
  capabilities: readonly CapabilityDeclaration[],
): Cacheability {
  if (!provider.cacheable) return provider;
  if (capabilities.some((item) => !item.identity.cacheable)) {
    return Object.freeze({ cacheable: false, reason: "capability-not-cacheable" });
  }
  return provider;
}

function failedDiagnostics(diagnostics: HostEnvironmentDiagnostic[]): DescribeEnvironmentResult {
  return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
}

function failure(code: HostEnvironmentDiagnosticCode): DescribeEnvironmentResult {
  return failedDiagnostics([environmentDiagnostic(code)]);
}

function providerFailure(): DescribeEnvironmentResult {
  return failure("HOST_ENVIRONMENT_INVALID_PROVIDER");
}

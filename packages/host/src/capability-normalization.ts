import type {
  Cacheability,
  CapabilityDeclaration,
  HostDiagnostic,
  LiveCapability,
} from "./contracts.js";
import { environmentDiagnostic } from "./diagnostics.js";
import { normalizeIdentity, subordinateIdentity } from "./identity.js";
import { readArray, validName } from "./input-readers.js";
import { readOwnDataRecord } from "./serializable.js";

export interface CapabilityState {
  readonly declarations: CapabilityDeclaration[];
  readonly live: Record<string, LiveCapability>;
  readonly diagnostics: HostDiagnostic[];
}

export function normalizeCapabilities(input: unknown, provider: Cacheability): CapabilityState {
  const state: CapabilityState = { declarations: [], live: Object.create(null), diagnostics: [] };
  if (input === undefined) return state;
  const items = readArray(input, 4_096);
  if (!items) {
    state.diagnostics.push(environmentDiagnostic("HOST_ENVIRONMENT_INVALID_CAPABILITY"));
    return state;
  }
  for (const item of items) addCapability(item, provider, state);
  return state;
}

function addCapability(input: unknown, provider: Cacheability, state: CapabilityState): void {
  const inspected = readOwnDataRecord(input, 12);
  if (!inspected.ok || !validCapabilityFields(inspected.value)) {
    state.diagnostics.push(environmentDiagnostic("HOST_ENVIRONMENT_INVALID_CAPABILITY"));
    return;
  }
  const record = inspected.value;
  if (state.live[record.handle as string]) {
    state.diagnostics.push(environmentDiagnostic("HOST_ENVIRONMENT_DUPLICATE_CAPABILITY"));
    return;
  }
  const identity = normalizeCapabilityIdentity(record);
  if (!identity) {
    state.diagnostics.push(environmentDiagnostic("HOST_ENVIRONMENT_INVALID_IDENTITY"));
    return;
  }
  addLiveCapability(record, subordinateIdentity(identity, provider), state);
}

function normalizeCapabilityIdentity(record: Record<string, unknown>): Cacheability | null {
  const result = normalizeIdentity({
    id: record.capabilityId,
    version: record.capabilityVersion,
    configurationDigest: record.configurationDigest,
    cacheable: record.cacheable,
  });
  return result.ok ? result.value : null;
}

function addLiveCapability(
  record: Record<string, unknown>,
  identity: Cacheability,
  state: CapabilityState,
): void {
  const declaration = createDeclaration(record, identity);
  const live =
    declaration.kind === "validator"
      ? Object.freeze({
          ...declaration,
          kind: "validator" as const,
          decode: record.decode as never,
        })
      : Object.freeze({ ...declaration, kind: "codec" as const, convert: record.convert as never });
  state.declarations.push(declaration);
  state.live[declaration.handle] = live;
}

function createDeclaration(
  record: Record<string, unknown>,
  identity: Cacheability,
): CapabilityDeclaration {
  return Object.freeze({
    handle: record.handle as string,
    kind: record.kind as "validator" | "codec",
    mode: record.mode as "sync" | "async",
    ...(record.capabilityId ? { capabilityId: record.capabilityId as string } : {}),
    ...(record.capabilityVersion ? { capabilityVersion: record.capabilityVersion as string } : {}),
    ...(record.configurationDigest
      ? { configurationDigest: record.configurationDigest as string }
      : {}),
    identity,
  });
}

function validCapabilityFields(record: Record<string, unknown>): boolean {
  if (!validName(record.handle) || (record.mode !== "sync" && record.mode !== "async"))
    return false;
  if (record.kind === "validator") return typeof record.decode === "function";
  if (record.kind === "codec") return typeof record.convert === "function";
  return false;
}

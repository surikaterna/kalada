import type { Cacheability } from "./contracts.js";
import { readOwnDataRecord } from "./serializable.js";

export type IdentityResult = Readonly<{ ok: true; value: Cacheability }> | Readonly<{ ok: false }>;

export function normalizeIdentity(input: unknown): IdentityResult {
  const inspected = readOwnDataRecord(input, 8);
  if (!inspected.ok) return Object.freeze({ ok: false });
  const record = inspected.value;
  if (!validOptionalBoolean(record.cacheable)) return Object.freeze({ ok: false });
  if (!validOptionalString(record.id) || !validOptionalString(record.version)) {
    return Object.freeze({ ok: false });
  }
  if (!validOptionalString(record.configurationDigest)) return Object.freeze({ ok: false });
  if (record.cacheable === false) return nonCacheable("explicitly-disabled");
  if (!record.id || !record.version || !record.configurationDigest) {
    return nonCacheable("missing-identity");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      cacheable: true,
      id: record.id,
      version: record.version,
      configurationDigest: record.configurationDigest,
    }),
  });
}

export function subordinateIdentity(identity: Cacheability, provider: Cacheability): Cacheability {
  if (!provider.cacheable && identity.cacheable) {
    return Object.freeze({ cacheable: false, reason: "provider-not-cacheable" });
  }
  return identity;
}

function nonCacheable(reason: "explicitly-disabled" | "missing-identity"): IdentityResult {
  return Object.freeze({
    ok: true,
    value: Object.freeze({ cacheable: false, reason }),
  });
}

function validOptionalString(input: unknown): input is string | undefined {
  return (
    input === undefined || (typeof input === "string" && input.length > 0 && input.length <= 256)
  );
}

function validOptionalBoolean(input: unknown): input is boolean | undefined {
  return input === undefined || typeof input === "boolean";
}

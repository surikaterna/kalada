import type { CapabilitySnapshot, LiveCapability, NormalizedEnvironment } from "./contracts.js";

const constructionToken = Object.freeze({});

class AuthenticCapabilitySnapshot implements CapabilitySnapshot {
  readonly scope = "instance" as const;
  readonly capabilities: Readonly<Record<string, LiveCapability>>;
  readonly #environment: NormalizedEnvironment;

  constructor(
    token: object,
    environment: NormalizedEnvironment,
    capabilities: Readonly<Record<string, LiveCapability>>,
  ) {
    if (token !== constructionToken)
      throw new TypeError("Invalid capability snapshot construction.");
    this.#environment = environment;
    this.capabilities = capabilities;
    Object.freeze(this);
  }

  static compatible(input: unknown, environment: NormalizedEnvironment): boolean {
    if (typeof input !== "object" || input === null || !(#environment in input)) return false;
    if (input.#environment === environment) return true;
    return cacheableEquivalent(input.#environment, environment);
  }
}

Object.freeze(AuthenticCapabilitySnapshot.compatible);
Object.freeze(AuthenticCapabilitySnapshot.prototype);
Object.freeze(AuthenticCapabilitySnapshot);

export function createCapabilitySnapshot(
  environment: NormalizedEnvironment,
  capabilities: Readonly<Record<string, LiveCapability>>,
): CapabilitySnapshot {
  return new AuthenticCapabilitySnapshot(constructionToken, environment, capabilities);
}

export function capabilitySnapshotMatches(
  snapshot: unknown,
  environment: NormalizedEnvironment,
): snapshot is CapabilitySnapshot {
  return AuthenticCapabilitySnapshot.compatible(snapshot, environment);
}

function cacheableEquivalent(left: NormalizedEnvironment, right: NormalizedEnvironment): boolean {
  if (!left.cacheability.cacheable || !right.cacheability.cacheable) return false;
  return (
    JSON.stringify(left.provider.identity) === JSON.stringify(right.provider.identity) &&
    JSON.stringify(left.capabilities) === JSON.stringify(right.capabilities)
  );
}

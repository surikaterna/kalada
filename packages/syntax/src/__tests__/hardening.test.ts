import { describe, expect, it } from "vitest";
import {
  formatKaladaV1Expression,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "../index.js";

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !("value" in descriptor) || recursivelyFrozen(descriptor.value, seen);
  });
}

describe("immutability and hostile boundaries", () => {
  it("recursively freezes parse, lower, and format outcomes", () => {
    const parsed = parseKaladaV1Expression("(a?.field ?? b)");
    const lowered = lowerKaladaV1Expression(parsed);
    const formatted = formatKaladaV1Expression(parsed.document.source);
    expect(recursivelyFrozen(parsed)).toBe(true);
    expect(recursivelyFrozen(lowered)).toBe(true);
    expect(recursivelyFrozen(formatted)).toBe(true);
  });

  it("uses own data descriptors and closes supplied environments", () => {
    const inherited = Object.create({ hidden: { reference: "hidden", type: "dynamic" } });
    Object.defineProperty(inherited, "safe", {
      enumerable: true,
      value: { reference: "safe", type: "dynamic" },
    });
    expect(
      lowerKaladaV1Expression(parseKaladaV1Expression("safe"), { references: inherited }).ok,
    ).toBe(true);
    expect(
      lowerKaladaV1Expression(parseKaladaV1Expression("hidden"), { references: inherited }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: "KALADA_SYNTAX_UNKNOWN_REFERENCE" }] });
  });

  it("never invokes environment or binding getters", () => {
    let calls = 0;
    const references = Object.defineProperty({}, "item", {
      enumerable: true,
      get: () => {
        calls += 1;
        throw new Error("getter");
      },
    });
    const outcome = lowerKaladaV1Expression(parseKaladaV1Expression("item"), { references });
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_INVALID_INPUT" }],
    });
    expect(calls).toBe(0);
  });

  it("contains revoked proxies at public boundaries", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => parseKaladaV1Expression("a", proxy)).not.toThrow();
    expect(() => lowerKaladaV1Expression(parseKaladaV1Expression("a"), proxy)).not.toThrow();
  });

  it.each(["maxTokens", "maxStaticTypeDepth"] as const)(
    "rejects an accessor-valued nested %s limit without invocation",
    (key) => {
      let calls = 0;
      const limits = Object.defineProperty({}, key, {
        enumerable: true,
        get: () => {
          calls += 1;
          return 10;
        },
      });
      const result = parseKaladaV1Expression("a", { limits });
      expect(result).toMatchObject({
        diagnostics: [{ code: "KALADA_SYNTAX_INVALID_INPUT" }],
      });
      expect(calls).toBe(0);
    },
  );
});

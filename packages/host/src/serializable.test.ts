import { describe, expect, it } from "vitest";
import { cloneSerializableData } from "./index.js";

describe("serializable data cloning", () => {
  it("sanitizes revoked proxies at the root and nested locations", () => {
    const root = revokedProxy();
    const objectChild = revokedProxy();
    const arrayChild = revokedProxy();

    expect(() => cloneSerializableData(root)).not.toThrow();
    const rootResult = cloneSerializableData(root);
    expect(rootResult).toEqual(failure("invalid-value", []));
    expectFrozenSanitizedFailure(rootResult);
    expect(cloneSerializableData({ nested: objectChild })).toEqual(
      failure("invalid-value", ["nested"]),
    );
    expect(cloneSerializableData(["safe", arrayChild])).toEqual(failure("invalid-value", [1]));
  });

  it.each(["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const)(
    "sanitizes a throwing %s object reflection trap",
    (trap) => {
      const input = throwingRecordProxy(trap);
      const result = cloneSerializableData(input);

      expect(result).toEqual(failure("invalid-value", []));
      expectFrozenSanitizedFailure(result);
    },
  );

  it.each([
    { reflectedKey: "length", path: [] },
    { reflectedKey: "0", path: [0] },
  ])(
    "sanitizes array descriptor trap at $reflectedKey without unrelated traps",
    ({ reflectedKey, path }) => {
      let ownKeysCalled = false;
      let prototypeCalled = false;
      const input = new Proxy(["secret"], {
        getPrototypeOf() {
          prototypeCalled = true;
          throw new Error("SECRET prototype trap");
        },
        ownKeys() {
          ownKeysCalled = true;
          throw new Error("SECRET ownKeys trap");
        },
        getOwnPropertyDescriptor(target, key) {
          if (key === reflectedKey) throw new Error("SECRET array descriptor trap");
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      const result = cloneSerializableData(input);
      expect(result).toEqual(failure("invalid-value", path));
      expect(ownKeysCalled).toBe(false);
      expect(prototypeCalled).toBe(false);
      expectFrozenSanitizedFailure(result);
    },
  );

  it("never invokes object or array accessors", () => {
    let calls = 0;
    const object = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("SECRET getter");
      },
    });
    const array = [0];
    Object.defineProperty(array, "0", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("SECRET getter");
      },
    });

    expect(cloneSerializableData({ nested: object })).toEqual(failure("accessor", ["nested"]));
    expect(cloneSerializableData(array)).toEqual(failure("accessor", [0]));
    expect(calls).toBe(0);
  });

  it("rejects cycles but duplicates shared aliases", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const shared = { value: 1 };

    expect(cloneSerializableData(cyclic)).toEqual(failure("cycle", ["self"]));
    const result = cloneSerializableData({ first: shared, second: shared });
    expect(result.ok).toBe(true);
    if (
      !result.ok ||
      typeof result.value !== "object" ||
      result.value === null ||
      Array.isArray(result.value)
    )
      return;
    expect(result.value).toEqual({ first: { value: 1 }, second: { value: 1 } });
    const record = result.value as { readonly first: unknown; readonly second: unknown };
    expect(record.first).not.toBe(record.second);
  });

  it("clones arrays and plain or null-prototype records immutably", () => {
    const input: Record<string, unknown> = Object.create(null);
    input.values = [null, false, 0, ""];
    const result = cloneSerializableData(input);

    expect(result.ok).toBe(true);
    if (!result.ok || typeof result.value !== "object" || result.value === null) return;
    expect(result.value).toEqual({ values: [null, false, 0, ""] });
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.values)).toBe(true);
  });

  it("enforces depth, node, collection, and string limits at exact paths", () => {
    const limits = { maxDepth: 2, maxNodes: 10, maxCollectionSize: 10, maxStringLength: 10 };

    expect(cloneSerializableData({ nested: null }, { ...limits, maxDepth: 0 })).toEqual(
      failure("depth-limit", ["nested"]),
    );
    expect(cloneSerializableData({ nested: {} }, { ...limits, maxNodes: 1 })).toEqual(
      failure("size-limit", ["nested"]),
    );
    expect(cloneSerializableData([0, 1], { ...limits, maxCollectionSize: 1 })).toEqual(
      failure("size-limit", []),
    );
    expect(cloneSerializableData("long", { ...limits, maxStringLength: 3 })).toEqual(
      failure("size-limit", []),
    );
    const oversizedKey = "SECRET-oversized-key";
    const keyResult = cloneSerializableData(
      { [oversizedKey]: 0 },
      { ...limits, maxStringLength: 3 },
    );
    expect(keyResult).toEqual(failure("size-limit", []));
    expect(JSON.stringify(keyResult)).not.toContain(oversizedKey);
  });
});

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

function throwingRecordProxy(
  trap: "getPrototypeOf" | "ownKeys" | "getOwnPropertyDescriptor",
): object {
  const failureTrap = () => {
    throw new Error(`SECRET ${trap} trap`);
  };
  return new Proxy(
    { value: 1 },
    {
      ...(trap === "getPrototypeOf" ? { getPrototypeOf: failureTrap } : {}),
      ...(trap === "ownKeys" ? { ownKeys: failureTrap } : {}),
      ...(trap === "getOwnPropertyDescriptor" ? { getOwnPropertyDescriptor: failureTrap } : {}),
    },
  );
}

function failure(reason: string, path: readonly (string | number)[]) {
  return { ok: false, reason, path };
}

function expectFrozenSanitizedFailure(result: ReturnType<typeof cloneSerializableData>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.path)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/SECRET|trap|TypeError|stack/u);
}

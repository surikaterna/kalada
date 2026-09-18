import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { compileKaladaV1Program, KaladaV1 } from "../index.js";

function referenceProgram() {
  const result = compileKaladaV1Program(KaladaV1.program(KaladaV1.ref("value")));
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

function expectAsyncFailure(value: unknown): void {
  expect(referenceProgram().evaluate((() => value) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_ASYNC_UNSUPPORTED", path: ["expression"] },
  });
}

async function expectNoUnhandled(promise: Promise<unknown>): Promise<void> {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    expectAsyncFailure(promise);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", listener);
  }
}

function hostileConstructor(configurable: boolean, read: () => void): PropertyDescriptor {
  return {
    configurable,
    get() {
      read();
      throw new Error("must not be read");
    },
  };
}

function expectHostileRejectedIsUnattached(configurable: boolean): void {
  const index = resolve(import.meta.dirname, "../index.ts");
  const script = `
    import { compileKaladaV1Program, KaladaV1 } from ${JSON.stringify(index)};
    const compiled = compileKaladaV1Program(KaladaV1.program(KaladaV1.ref("value")));
    if (!compiled.ok) throw new Error("compile failed");
    const seen = [];
    process.on("unhandledRejection", (reason) => seen.push(reason));
    let reads = 0;
    const promise = Promise.reject(new Error("host-owned"));
    const getter = () => { reads += 1; throw new Error("must not be read"); };
    Object.defineProperty(promise, "constructor", { configurable: ${configurable}, get: getter });
    const before = Object.getOwnPropertyDescriptor(promise, "constructor");
    const outcome = compiled.value.evaluate(() => promise);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = Object.getOwnPropertyDescriptor(promise, "constructor");
    console.log(JSON.stringify({ code: outcome.ok ? null : outcome.diagnostic.code,
      reads, unhandled: seen.length, same: before.get === after.get &&
      before.configurable === after.configurable && before.enumerable === after.enumerable }));
  `;
  const result = spawnSync("bun", ["--eval", script], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({
    code: "KALADA_ASYNC_UNSUPPORTED",
    reads: 0,
    unhandled: 1,
    same: true,
  });
}

it("rejects a native Promise without reading its hostile catch property", () => {
  const promise = Promise.resolve({ found: true, value: 1 });
  Object.defineProperty(promise, "catch", {
    get() {
      throw new Error("must not be read");
    },
  });
  expectAsyncFailure(promise);
});

it("contains ordinary fulfilled Promises", () => {
  expectAsyncFailure(Promise.resolve({ found: true, value: 1 }));
});

it.each([true, false])(
  "does not mutate or read a hostile constructor descriptor (configurable: %s)",
  (configurable) => {
    const promise = Promise.resolve(1);
    let reads = 0;
    const descriptor = hostileConstructor(configurable, () => {
      reads += 1;
    });
    Object.defineProperty(promise, "constructor", descriptor);
    const before = Object.getOwnPropertyDescriptor(promise, "constructor");
    expectAsyncFailure(promise);
    expect(Object.getOwnPropertyDescriptor(promise, "constructor")).toEqual(before);
    expect(reads).toBe(0);
  },
);

it.each([true, false])(
  "leaves hostile rejected Promise ownership with its host (configurable: %s)",
  (configurable) => {
    expectHostileRejectedIsUnattached(configurable);
  },
);

it.each([null, {}, 1])(
  "contains unusable constructor data without mutation",
  (constructorValue) => {
    const promise = Promise.resolve(1);
    Object.defineProperty(promise, "constructor", {
      configurable: true,
      value: constructorValue,
    });
    const before = Object.getOwnPropertyDescriptor(promise, "constructor");
    expectAsyncFailure(promise);
    expect(Object.getOwnPropertyDescriptor(promise, "constructor")).toEqual(before);
  },
);

it.each(["same realm", "cross realm"])("consumes rejected %s Promises", async (realm) => {
  const promise: Promise<unknown> =
    realm === "same realm"
      ? Promise.reject(new Error("secret"))
      : runInNewContext("Promise.reject(new Error('secret'))");
  await expectNoUnhandled(promise);
});

it("contains Promise.prototype spoofs without invoking their then property", () => {
  let calls = 0;
  const spoof = Object.create(Promise.prototype);
  const thenKey = ["th", "en"].join("");
  Object.defineProperty(spoof, thenKey, {
    value: () => {
      calls += 1;
    },
  });
  expectAsyncFailure(spoof);
  expect(calls).toBe(0);
});

it("contains thenable getters without reading them", () => {
  let reads = 0;
  const thenKey = ["th", "en"].join("");
  const thenable = Object.defineProperty({}, thenKey, {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error("must not be read");
    },
  });
  expect(referenceProgram().evaluate((() => thenable) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_REFERENCE_ERROR" },
  });
  expect(reads).toBe(0);
});

it("contains Promise proxies without leaking their brand failure", () => {
  const promise = new Proxy(Promise.resolve(1), {});
  expectAsyncFailure(promise);
});

it("does not attempt mutation or restoration through a Promise proxy", () => {
  let mutations = 0;
  const promise = new Proxy(Promise.resolve(1), {
    defineProperty() {
      mutations += 1;
      throw new Error("must not mutate");
    },
  });
  expectAsyncFailure(promise);
  expect(mutations).toBe(0);
});

it("contains subclasses and hostile species without invoking constructors", () => {
  let speciesReads = 0;
  class HostilePromise<T> extends Promise<T> {
    static override get [Symbol.species](): PromiseConstructor {
      speciesReads += 1;
      throw new Error("must not be read");
    }
  }
  const promise = new HostilePromise<number>((resolve) => resolve(1));
  expectAsyncFailure(promise);
  expect(speciesReads).toBe(0);
});

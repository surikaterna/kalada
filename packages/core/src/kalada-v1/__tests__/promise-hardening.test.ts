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

it("rejects a native Promise without reading its hostile catch property", () => {
  const promise = Promise.resolve({ found: true, value: 1 });
  Object.defineProperty(promise, "catch", {
    get() {
      throw new Error("must not be read");
    },
  });
  expectAsyncFailure(promise);
});

it("rejects a pre-handled suspicious Promise without property access", async () => {
  const promise = Promise.reject(new Error("secret"));
  await promise.catch(() => undefined);
  let reads = 0;
  Object.defineProperty(promise, "constructor", {
    get() {
      reads += 1;
      throw new Error("must not be read");
    },
  });
  expectAsyncFailure(promise);
  expect(reads).toBe(0);
});

it.each(["same realm", "cross realm"])("consumes rejected %s Promises", async (realm) => {
  const promise: Promise<unknown> =
    realm === "same realm"
      ? Promise.reject(new Error("secret"))
      : runInNewContext("Promise.reject(new Error('secret'))");
  await expectNoUnhandled(promise);
});

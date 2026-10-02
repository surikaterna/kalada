import { expect, it } from "vitest";
import { EditorRequests, type RequestTicket, resolveResponse } from "./editor-requests.js";

const snapshot = { uri: "fixture:reentrant", version: 1, text: "red", environmentGeneration: 0 };
const start = (requests: EditorRequests) =>
  requests.start(
    "format",
    snapshot,
    () => snapshot,
    () => true,
  );

const result = { ...snapshot, value: "done" };

it("keeps settled response guards current until invalidation without aborting completed work", () => {
  const requests = new EditorRequests();
  const ticket = start(requests);
  expect(resolveResponse(result, ticket, () => ticket.current(), false)).toBe(true);
  expect(ticket.current()).toBe(true);
  requests.invalidate();
  expect(ticket.current()).toBe(false);
  expect(ticket.signal.aborted).toBe(false);
});

it.each(["sync", "async", "null", "rejected"])(
  "does not abort a settled %s response on replacement or invalidation",
  async (mode) => {
    const requests = new EditorRequests();
    const ticket = start(requests);
    let aborts = 0;
    ticket.signal.addEventListener("abort", () => aborts++);
    const response =
      mode === "async"
        ? Promise.resolve(result)
        : mode === "rejected"
          ? Promise.reject()
          : mode === "null"
            ? null
            : result;
    await resolveResponse(response, ticket, () => true, false);
    expect(ticket.current()).toBe(true);
    start(requests);
    expect(ticket.current()).toBe(false);
    requests.invalidate();
    expect(aborts).toBe(0);
  },
);

it("settles before publication reenters and preserves the newer pending request", () => {
  const requests = new EditorRequests();
  const ticket = start(requests);
  let newer: RequestTicket | undefined;
  resolveResponse(
    result,
    ticket,
    () => {
      newer = start(requests);
      return true;
    },
    false,
  );
  expect(ticket.signal.aborted).toBe(false);
  expect(newer?.current()).toBe(true);
  requests.invalidate();
  expect(newer?.signal.aborted).toBe(true);
});

it("does not remove a newer pending request when an obsolete response settles", async () => {
  const requests = new EditorRequests();
  const obsolete = start(requests);
  const newer = start(requests);
  expect(await resolveResponse(Promise.resolve(result), obsolete, () => true, false)).toBe(false);
  requests.invalidate();
  expect(newer.signal.aborted).toBe(true);
});

it("propagates synchronous and asynchronous publication errors, but falls back on rejection", async () => {
  const requests = new EditorRequests();
  const error = new Error("dispatch failed");
  const publish = () => {
    throw error;
  };
  expect(() => resolveResponse(result, start(requests), publish, false)).toThrow(error);
  await expect(
    resolveResponse(Promise.resolve(result), start(requests), publish, false),
  ).rejects.toBe(error);
  expect(await resolveResponse(Promise.reject(error), start(requests), publish, false)).toBe(false);
});

it("propagates errors from asynchronous acceptance guards", async () => {
  const requests = new EditorRequests();
  const error = new Error("currentness failed");
  const ticket = {
    ...start(requests),
    current: () => {
      throw error;
    },
  };
  await expect(resolveResponse(Promise.resolve(result), ticket, () => true, false)).rejects.toBe(
    error,
  );
  requests.invalidate();
  expect(ticket.signal.aborted).toBe(false);
});

it("keeps the nested same-feature request registered when a superseded request aborts", () => {
  const requests = new EditorRequests();
  const first = start(requests);
  let nested: RequestTicket | undefined;
  first.signal.addEventListener(
    "abort",
    () => {
      nested = start(requests);
    },
    { once: true },
  );
  const outer = start(requests);
  expect(first.current()).toBe(false);
  expect(outer.signal.aborted).toBe(true);
  expect(outer.current()).toBe(false);
  expect(nested?.current()).toBe(true);
  const latest = start(requests);
  expect(nested?.signal.aborted).toBe(true);
  expect(nested?.current()).toBe(false);
  expect(latest.current()).toBe(true);
});

it("does not revive a replacement invalidated synchronously by an abort listener", () => {
  const requests = new EditorRequests();
  const first = start(requests);
  first.signal.addEventListener("abort", () => requests.invalidate(), { once: true });
  const outer = start(requests);
  expect(outer.signal.aborted).toBe(true);
  expect(outer.current()).toBe(false);
  expect(start(requests).current()).toBe(true);
});

it("retains requests started after the invalidation boundary instead of clearing them after abort", () => {
  const requests = new EditorRequests();
  const first = start(requests);
  let nested: RequestTicket | undefined;
  first.signal.addEventListener(
    "abort",
    () => {
      nested = start(requests);
    },
    { once: true },
  );
  requests.invalidate();
  expect(first.signal.aborted).toBe(true);
  expect(first.current()).toBe(false);
  expect(nested?.current()).toBe(true);
  requests.invalidate();
  expect(nested?.signal.aborted).toBe(true);
  expect(nested?.current()).toBe(false);
});

it("supports recursive cancellation without visiting a mutating registry", () => {
  const requests = new EditorRequests();
  const first = start(requests);
  let nested: RequestTicket | undefined;
  first.signal.addEventListener(
    "abort",
    () => {
      nested = start(requests);
      requests.invalidate();
    },
    { once: true },
  );
  requests.invalidate();
  expect(first.current()).toBe(false);
  expect(nested?.signal.aborted).toBe(true);
  expect(nested?.current()).toBe(false);
  expect(start(requests).current()).toBe(true);
});

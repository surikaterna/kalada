import { expect, it } from "vitest";
import { EditorRequests, type RequestTicket } from "./editor-requests.js";

const snapshot = { uri: "fixture:reentrant", version: 1, text: "red", environmentGeneration: 0 };
const start = (requests: EditorRequests) =>
  requests.start(
    "format",
    snapshot,
    () => snapshot,
    () => true,
  );

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

import { describe, expect, it, vi } from "vitest";
import { createEditorSession } from "./editor.js";
import { EditorRequests, resolveResponse } from "./editor-requests.js";
import { editorOffset, sourceOffset, validEdit } from "./editor-validation.js";
import { textForEditor } from "./line-separator.js";

const document = { uri: "memory:///independent.txt", version: 2, text: "😀\r\nred" };

describe("neutral editor", () => {
  it("owns immutable snapshots without a provider, swallows host callbacks, and disposes idempotently", () => {
    const changed = vi.fn(() => {
      throw new Error("host");
    });
    const session = createEditorSession({ document, onDocumentChange: changed });
    expect(session.format()).toBe(false);
    session.replaceDocument("blue\r\n😀");
    expect(session.getSnapshot()).toEqual({
      ...document,
      version: 3,
      text: "blue\r\n😀",
      environmentGeneration: 0,
    });
    expect(Object.isFrozen(session.getSnapshot())).toBe(true);
    session.refreshEnvironment();
    expect(session.getSnapshot().environmentGeneration).toBe(1);
    expect(changed).toHaveBeenCalledTimes(1);
    session.dispose();
    session.dispose();
    expect(() => session.refreshEnvironment()).toThrow("disposed");
    expect(() => session.format()).toThrow("disposed");
  });

  it("validates initial versions and revision exhaustion", () => {
    expect(() => createEditorSession({ document: { ...document, version: NaN } })).toThrow();
    const session = createEditorSession({
      document: { ...document, version: Number.MAX_SAFE_INTEGER },
    });
    expect(() => session.replaceDocument("x")).toThrow("exhausted");
    session.dispose();
  });

  it("maps CRLF source offsets without counting emoji as code points", () => {
    const doc = textForEditor(document.text);
    expect(sourceOffset(doc, "\r\n", 3)).toBe(4);
    expect(editorOffset(doc, "\r\n", 4)).toBe(3);
    expect(validEdit({ from: 4, to: 7, text: "blue" }, document.text)).toBe(true);
    for (const from of [-1, NaN, 0.5, 1, 3, 8])
      expect(validEdit({ from, to: from, text: "x" }, document.text)).toBe(false);
    expect(validEdit({ from: 5, to: 4, text: "x" }, document.text)).toBe(false);
    expect(validEdit({ from: 4, to: 99, text: "x" }, document.text)).toBe(false);
    expect(validEdit(undefined as never, document.text)).toBe(false);
    expect(validEdit({ from: 4, to: 7, text: 42 } as never, document.text)).toBe(false);
  });
});

describe("request guards", () => {
  it("rejects identity mismatch, reentrant edits and invalidated asynchronous responses", async () => {
    const requests = new EditorRequests();
    let snapshot = { ...document, environmentGeneration: 0 };
    const ticket = requests.start(
      "format",
      snapshot,
      () => snapshot,
      () => true,
    );
    const publish = vi.fn(() => true);
    expect(
      resolveResponse({ ...snapshot, version: 99, value: "bad" }, ticket, publish, false),
    ).toBe(false);
    snapshot = { ...snapshot, version: 3 };
    expect(
      resolveResponse({ ...ticket.snapshot, value: "reentrant" }, ticket, publish, false),
    ).toBe(false);
    const pending = requests.start(
      "hover",
      snapshot,
      () => snapshot,
      () => true,
    );
    const response = resolveResponse(
      Promise.resolve({ ...snapshot, value: "late" }),
      pending,
      publish,
      false,
    );
    requests.invalidate();
    expect(pending.signal.aborted).toBe(true);
    expect(await response).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels superseded requests, detach and rejects provider promise errors", async () => {
    const requests = new EditorRequests();
    const snapshot = { ...document, environmentGeneration: 0 };
    let alive = true;
    const first = requests.start(
      "completion",
      snapshot,
      () => snapshot,
      () => alive,
    );
    const second = requests.start(
      "completion",
      snapshot,
      () => snapshot,
      () => alive,
    );
    expect(first.signal.aborted).toBe(true);
    expect(
      await resolveResponse(Promise.reject(new Error("provider")), second, () => true, false),
    ).toBe(false);
    alive = false;
    expect(second.current()).toBe(false);
  });
});

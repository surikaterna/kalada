import { normalizeManualEnvironment } from "@kalada/host";
import {
  createLanguageService,
  type DocumentUpdate,
  type LanguageService,
} from "@kalada/language-service";
import { expect, it, vi } from "vitest";
import { createKaladaEditorSession } from "./index.js";

function fixture() {
  const language = createLanguageService({
    generation: 1,
    description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
  });
  const document = { uri: "memory:///failure.kalada", version: 1, text: "1" };
  return { language, document };
}

function expectOriginalError(action: () => void, failure: Error) {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
}

it("restores a rejected detached attempt and rethrows the original error without notification", () => {
  const { language, document } = fixture();
  const failure = new Error("one-shot precommit rejection");
  const update = vi.fn((input: DocumentUpdate) => language.updateDocument(input));
  update.mockImplementationOnce(() => {
    throw failure;
  });
  const wrapped: LanguageService = Object.assign(Object.create(language), {
    updateDocument: update,
  });
  const changed = vi.fn();
  const session = createKaladaEditorSession({
    service: wrapped,
    document,
    onDocumentChange: changed,
  });
  expectOriginalError(() => session.replaceDocument("2"), failure);
  expect(language.getDocument(document.uri)).toMatchObject(document);
  expect(changed).not.toHaveBeenCalled();
  session.replaceDocument("3");
  expect(language.getDocument(document.uri)).toMatchObject({ version: 2, text: "3" });
  expect(changed).toHaveBeenCalledExactlyOnceWith(language.getDocument(document.uri));
  expect(update).toHaveBeenCalledTimes(2);
  session.dispose();
});

it.each(["unmatched", "unobservable", "refresh"])(
  "fails terminally when reconciliation is %s",
  (kind) => {
    const { language, document } = fixture();
    const failure = new Error("unprovable commit");
    let observing = true;
    const update = vi.fn(() => {
      if (kind === "unmatched")
        language.updateDocument({ uri: document.uri, version: 9, edits: [] });
      if (kind === "unobservable") observing = false;
      if (kind === "refresh") session.refreshEnvironment();
      throw failure;
    });
    const wrapped: LanguageService = Object.assign(Object.create(language), {
      updateDocument: update,
      getDocument(uri: string) {
        if (!observing) throw new Error("cannot observe");
        return language.getDocument(uri);
      },
    });
    const changed = vi.fn();
    const session = createKaladaEditorSession({
      service: wrapped,
      document,
      onDocumentChange: changed,
    });
    expectOriginalError(() => session.replaceDocument("2"), failure);
    expect(changed).not.toHaveBeenCalled();
    expect(() => session.replaceDocument("3")).toThrow("session has failed");
    expect(() => session.format()).toThrow("session has failed");
    expect(() => session.refreshEnvironment()).toThrow("session has failed");
    expect(update).toHaveBeenCalledTimes(1);
    session.dispose();
    session.dispose();
    expect(language.getDocument(document.uri)).toBeUndefined();
  },
);

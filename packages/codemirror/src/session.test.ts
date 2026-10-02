import { normalizeManualEnvironment } from "@kalada/host";
import {
  createLanguageService,
  type DocumentSnapshot,
  type DocumentUpdate,
  type LanguageService,
} from "@kalada/language-service";
import { describe, expect, it, vi } from "vitest";
import { createKaladaEditorSession } from "./index.js";

function service() {
  return createLanguageService({
    generation: 1,
    description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
  });
}

describe("detached CodeMirror session", () => {
  it.each([2, 3])("orders service reentry through v%i before callback reentry", (through) => {
    const language = service();
    const snapshots: DocumentSnapshot[] = [];
    const committed: DocumentSnapshot[] = [];
    const update = language.updateDocument.bind(language);
    const wrapped: LanguageService = Object.assign(Object.create(language), {
      updateDocument(input: DocumentUpdate) {
        const snapshot = update(input);
        committed.push(snapshot);
        if (snapshot.version <= through) session.replaceDocument(String(snapshot.version + 1));
        return snapshot;
      },
    });
    const session = createKaladaEditorSession({
      service: wrapped,
      document: { uri: "memory:///reentry.kalada", version: 1, text: "1" },
      onDocumentChange: (snapshot) => {
        snapshots.push(snapshot);
        if (snapshot.version === 2) session.replaceDocument(String(through + 2));
      },
    });
    session.replaceDocument("2");
    expect(snapshots.map(({ version, text }) => [version, text])).toEqual(
      Array.from({ length: through + 1 }, (_, index) => [index + 2, String(index + 2)]),
    );
    for (const [index, snapshot] of snapshots.entries()) expect(snapshot).toBe(committed[index]);
    expect(language.getDocument("memory:///reentry.kalada")).toBe(snapshots.at(-1));
    session.dispose();
  });

  it.each([
    { through: 3, throwing: [2], expected: [3] },
    { through: 4, throwing: [2], expected: [3, 4] },
    { through: 4, throwing: [2, 3], expected: [4] },
  ])("drains nested successes: $throwing", ({ through, throwing, expected }) => {
    const language = service();
    const committed = new Map<number, DocumentSnapshot>();
    const snapshots: DocumentSnapshot[] = [];
    const failure = new Error("outer service hook failed");
    const update = language.updateDocument.bind(language);
    const wrapped: LanguageService = Object.assign(Object.create(language), {
      updateDocument(input: DocumentUpdate) {
        const snapshot = update(input);
        committed.set(snapshot.version, snapshot);
        if (snapshot.version < through) {
          try {
            session.replaceDocument(String(snapshot.version + 1));
          } catch (error) {
            expect(error).toBe(failure);
          }
        }
        if (throwing.includes(snapshot.version)) throw failure;
        return snapshot;
      },
    });
    const session = createKaladaEditorSession({
      service: wrapped,
      document: { uri: "memory:///nested-throw.kalada", version: 1, text: "1" },
      onDocumentChange: (snapshot) => snapshots.push(snapshot),
    });
    let caught: unknown;
    try {
      session.replaceDocument("2");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(snapshots.map(({ version }) => version)).toEqual(expected);
    for (const snapshot of snapshots) expect(snapshot).toBe(committed.get(snapshot.version));
    expect(language.getDocument("memory:///nested-throw.kalada")).toBe(committed.get(through));
    session.replaceDocument(String(through + 1));
    expect(snapshots.map(({ version }) => version)).toEqual([...expected, through + 1]);
    expect(snapshots.at(-1)).toBe(committed.get(through + 1));
    session.dispose();
  });

  it("does not publish a notification whose service hook threw", () => {
    const language = service();
    const update = language.updateDocument.bind(language);
    const wrapped: LanguageService = Object.assign(Object.create(language), {
      updateDocument(input: DocumentUpdate) {
        const snapshot = update(input);
        if (snapshot.version === 2) throw new Error("service hook failed after commit");
        return snapshot;
      },
    });
    const changed = vi.fn();
    const session = createKaladaEditorSession({
      service: wrapped,
      document: { uri: "memory:///failed-hook.kalada", version: 1, text: "1" },
      onDocumentChange: changed,
    });
    expect(() => session.replaceDocument("2")).toThrow("service hook failed after commit");
    expect(changed).not.toHaveBeenCalled();
    session.replaceDocument("3");
    expect(changed).toHaveBeenCalledExactlyOnceWith(
      language.getDocument("memory:///failed-hook.kalada"),
    );
    session.dispose();
  });

  it("owns open, replacement revision, notification, and idempotent disposal", () => {
    const language = service();
    const changed = vi.fn(() => {
      throw new Error("application callback");
    });
    const session = createKaladaEditorSession({
      service: language,
      document: { uri: "memory:///session.kalada", version: 4, text: "1+2" },
      onDocumentChange: changed,
    });
    expect(session.format()).toBe(false);
    session.replaceDocument("3 + 4");
    expect(language.getDocument("memory:///session.kalada")).toMatchObject({
      version: 5,
      text: "3 + 4",
    });
    expect(changed).toHaveBeenCalledTimes(1);
    session.dispose();
    session.dispose();
    expect(language.getDocument("memory:///session.kalada")).toBeUndefined();
    expect(() => session.replaceDocument("5")).toThrow("disposed");
  });

  it("rejects ambiguous ownership of an already-open URI", () => {
    const language = service();
    const document = { uri: "memory:///owned.kalada", version: 1, text: "1" };
    const first = createKaladaEditorSession({ service: language, document });
    expect(() => createKaladaEditorSession({ service: language, document })).toThrow();
    first.dispose();
  });

  it("preserves detached CRLF replacement text exactly", () => {
    const language = service();
    const session = createKaladaEditorSession({
      service: language,
      document: { uri: "memory:///crlf.kalada", version: 1, text: "a\r\nb" },
    });
    expect(language.getDocument("memory:///crlf.kalada")?.text).toBe("a\r\nb");
    session.replaceDocument("c\r\nd");
    expect(language.getDocument("memory:///crlf.kalada")?.text).toBe("c\r\nd");
    session.dispose();
  });
});

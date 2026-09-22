import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";
import { describe, expect, it, vi } from "vitest";
import { createKaladaEditorSession } from "./index.js";

function service() {
  return createLanguageService({
    generation: 1,
    description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
  });
}

describe("detached CodeMirror session", () => {
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
});

import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { createEditorSession } from "./editor.js";

it.each(["\n", "\r\n", "\r"])(
  "initializes new states with the current detached separator %j",
  (initial) => {
    const session = createEditorSession({
      document: { uri: "fixture:separator", version: 1, text: `a${initial}b` },
    });
    const extension = session.extension;
    for (const separator of ["\n", "\r\n", "\r", "\n"]) {
      const text = `😀${separator}red${separator}blue`;
      session.replaceDocument(text);
      const state = EditorState.create({ doc: session.getSnapshot().text, extensions: extension });
      expect(state.lineBreak).toBe(separator);
      expect(state.doc.lines).toBe(3);
      expect(state.sliceDoc()).toBe(text);
      expect(state.doc.line(2).text).toBe("red");
    }
    session.dispose();
  },
);

import { createRequire } from "node:module";
import { createEditorSession } from "@kalada/codemirror/editor";

const document = { uri: "memory:///independent.fixture", version: 1, text: "red" };
for (const create of [
  createEditorSession,
  createRequire(import.meta.url)("@kalada/codemirror/editor").createEditorSession,
]) {
  const session = create({
    document,
    provider: { diagnostics: ({ snapshot }) => ({ ...snapshot, value: [] }) },
  });
  session.replaceDocument("blue");
  if (session.getSnapshot().text !== "blue" || session.format() !== false)
    throw new Error("Neutral session failed");
  session.dispose();
}

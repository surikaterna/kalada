import {
  createEditorSession,
  type EditorProvider,
  type EditorSession,
} from "@kalada/codemirror/editor";

const provider: EditorProvider = {
  diagnostics: ({ snapshot }) => ({
    ...snapshot,
    value: [{ from: 0, to: 0, severity: "info", message: "Independent" }],
  }),
  completion: async ({ snapshot }, offset) => ({
    ...snapshot,
    value: [{ label: "blue", edit: { from: offset, to: offset, text: "blue" } }],
  }),
  hover: ({ snapshot }) => ({ ...snapshot, value: { from: 0, to: 0, content: "Plain text" } }),
  format: ({ snapshot }) => ({
    ...snapshot,
    value: { from: 0, to: snapshot.text.length, text: snapshot.text },
  }),
};
const session: EditorSession = createEditorSession({
  document: { uri: "fixture:", version: 1, text: "" },
  provider,
});
const formatted: boolean | Promise<boolean> = session.format();
void formatted;

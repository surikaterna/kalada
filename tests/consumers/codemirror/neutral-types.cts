import {
  createEditorSession,
  type EditorProvider,
  type EditorSession,
} from "@kalada/codemirror/editor";

const provider: EditorProvider = {
  format: async ({ snapshot }) => ({
    ...snapshot,
    value: { from: 0, to: snapshot.text.length, text: "blue" },
  }),
};
const session: EditorSession = createEditorSession({
  document: { uri: "fixture:", version: 1, text: "red" },
  provider,
});
const formatted: boolean | Promise<boolean> = session.format();
void formatted;

import {
  acceptCompletion,
  completionStatus,
  moveCompletionSelection,
  selectedCompletionIndex,
  startCompletion,
} from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createKaladaEditorSession } from "@kalada/codemirror";
import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

const shape = (field) => ({
  mode: "sync",
  providerId: `<img src=x onerror="window.__injected=true">`,
  providerVersion: "1",
  configurationDigest: field,
  bindings: [
    {
      id: "user-id",
      name: "user",
      path: ["user"],
      semanticType: { kind: "primitive-type", name: "json" },
      editorShape: {
        root: {
          kind: "object",
          properties: [
            { name: field, required: true, shape: { kind: "scalar", name: "string" } },
            {
              name: '<img src=x onerror="window.__injected=true">',
              required: false,
              shape: { kind: "scalar", name: "string" },
            },
          ],
        },
      },
    },
  ],
});

const service = createLanguageService({
  generation: 1,
  description: normalizeManualEnvironment(shape("name")),
});
const versions = [];
const session = createKaladaEditorSession({
  service,
  document: { uri: "memory:///browser.kalada", version: 1, text: "user." },
  onDocumentChange: ({ version }) => versions.push(version),
});
const view = new EditorView({
  state: EditorState.create({
    doc: "user.",
    selection: { anchor: 5 },
    extensions: [session.extension],
  }),
  parent: document.querySelector("#editor"),
});

window.__kalada = {
  view,
  session,
  service,
  versions,
  directCompletion: () => service.completion("memory:///browser.kalada", position()),
  directHover: () => service.hover("memory:///browser.kalada", position(1)),
  startCompletion: () => startCompletion(view),
  acceptCompletion: () => acceptCompletion(view),
  completionStatus: () => completionStatus(view.state),
  completionIndex: () => selectedCompletionIndex(view.state),
  selectCompletion: () => moveCompletionSelection(true)(view),
  replace: (text) => session.replaceDocument(text),
  moveToEnd: () => view.dispatch({ selection: { anchor: view.state.doc.length } }),
  format: () => session.format(),
  undo: () => undo(view),
  redo: () => redo(view),
  refresh: () => {
    service.updateEnvironment({
      generation: 2,
      description: normalizeManualEnvironment(shape("age")),
    });
    session.refreshEnvironment();
  },
  batch: () => {
    const first = view.state.update({
      changes: { from: 0, to: view.state.doc.length, insert: "user" },
    });
    const second = first.state.update({ changes: { from: 4, insert: "." } });
    view.dispatch([first, second]);
  },
  dispose: () => session.dispose(),
};
window.__kaladaReady = true;

function position(character = view.state.doc.length) {
  return { line: 0, character };
}

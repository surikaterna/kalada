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
  disposeThenEdit: () => {
    session.dispose();
    session.dispose();
    view.dispatch({ changes: { from: 0, insert: "x" } });
    const text = view.state.sliceDoc();
    const tooltips = document.querySelectorAll('[role="tooltip"]').length;
    const diagnostics = document.querySelectorAll(".cm-diagnostic").length;
    view.destroy();
    return {
      text,
      tooltips,
      diagnostics,
      open: service.getDocument("memory:///browser.kalada") !== undefined,
    };
  },
  crlfLifecycle: () => crlfLifecycle(),
};
window.__kaladaReady = true;

function position(character = view.state.doc.length) {
  return { line: 0, character };
}

function crlfLifecycle() {
  const crlfService = createLanguageService({
    generation: 1,
    description: normalizeManualEnvironment(shape("name")),
  });
  const crlfSession = createKaladaEditorSession({
    service: crlfService,
    document: { uri: "memory:///crlf.kalada", version: 1, text: "user.\r\n" },
  });
  const crlfView = new EditorView({
    state: EditorState.create({ doc: "user.\r\n", extensions: [crlfSession.extension] }),
    parent: document.querySelector("#editor"),
  });
  const opened = pair(crlfView, crlfService);
  crlfView.dispatch({ changes: { from: 5, insert: "name" } });
  const changed = pair(crlfView, crlfService);
  crlfSession.replaceDocument('user.name\r\n== "x"');
  const replaced = pair(crlfView, crlfService);
  crlfSession.format();
  const formatted = pair(crlfView, crlfService);
  crlfView.destroy();
  crlfSession.dispose();
  crlfSession.dispose();
  return { opened, changed, replaced, formatted };
}

function pair(targetView, targetService) {
  return {
    editor: targetView.state.sliceDoc(),
    service: targetService.getDocument("memory:///crlf.kalada")?.text,
  };
}

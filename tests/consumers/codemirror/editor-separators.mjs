import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createKaladaEditorSession } from "@kalada/codemirror";
import { createEditorSession } from "@kalada/codemirror/editor";
import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

const assert = (condition, message) => {
  if (!condition) throw new Error(`Separator lifecycle: ${message}`);
};

export function runSeparators() {
  for (const initial of ["\n", "\r\n", "\r"]) {
    exercise(initial, false);
    exercise(initial, true);
  }
}

function exercise(initial, kalada) {
  const document = { uri: "fixture:separators", version: 1, text: `1${initial}+ 2` };
  const service = kalada
    ? createLanguageService({
        generation: 1,
        description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
      })
    : null;
  const session = kalada
    ? createKaladaEditorSession({ service, document })
    : createEditorSession({ document });
  const extension = session.extension;
  const snapshot = () => (kalada ? service.getDocument(document.uri) : session.getSnapshot());
  const parent = window.document.createElement("div");
  window.document.body.append(parent);
  for (const separator of ["\n", "\r\n", "\r", "\n"]) {
    const text = `1${separator}+ 2${separator}+ 3`;
    session.replaceDocument(text);
    let view = mount(extension, snapshot().text, parent);
    verify(view, snapshot(), separator, text);
    const next = separator === "\n" ? "\r\n" : separator === "\r\n" ? "\r" : "\n";
    const replacement = `4${next}+ 5${next}+ 6`;
    session.replaceDocument(replacement);
    verify(view, snapshot(), next, replacement);
    view.destroy();
    view = mount(extension, snapshot().text, parent);
    verify(view, snapshot(), next, replacement);
    view.dispatch({ changes: { from: view.state.doc.length, insert: " + 7" } });
    verify(view, snapshot(), next, `${replacement} + 7`);
    view.destroy();
  }
  session.dispose();
  parent.remove();
}

function mount(extension, text, parent) {
  const state = EditorState.create({ doc: text, extensions: extension });
  return new EditorView({ state, parent });
}

function verify(view, snapshot, separator, text) {
  assert(view.state.lineBreak === separator, "current separator");
  assert(view.state.doc.lines === 3, "three parsed lines");
  assert(view.state.sliceDoc() === text, "editor text preserved");
  assert(snapshot.text === text, "session/service text preserved");
}

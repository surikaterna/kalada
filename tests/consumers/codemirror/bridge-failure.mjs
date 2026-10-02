import { acceptCompletion, startCompletion } from "@codemirror/autocomplete";
import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createKaladaEditorSession } from "@kalada/codemirror";
import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "@kalada/language-service";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fixture(postcommit, batched) {
  const language = createLanguageService({
    generation: 1,
    description: normalizeManualEnvironment({ mode: "sync", bindings: [] }),
  });
  const failure = new Error("attached bridge failure");
  const errors = [],
    snapshots = [],
    updates = [],
    committed = [];
  let toolingCalls = 0;
  const wrapped = Object.assign(Object.create(language), {
    updateDocument(input) {
      updates.push(input.version);
      const rejecting = input.version === (batched ? 3 : 2);
      if (rejecting && !postcommit) throw failure;
      const result = language.updateDocument(input);
      committed.push(result);
      if (rejecting) throw failure;
      return result;
    },
  });
  for (const key of ["diagnostics", "completion", "hover", "format"]) {
    wrapped[key] = (...args) => {
      toolingCalls += 1;
      return language[key](...args);
    };
  }
  const session = createKaladaEditorSession({
    service: wrapped,
    document: { uri: "memory:///bridge-failure.kalada", version: 1, text: "1" },
    onDocumentChange: (snapshot) => snapshots.push(snapshot),
  });
  const view = new EditorView({
    doc: "1",
    extensions: [session.extension, EditorView.exceptionSink.of((error) => errors.push(error))],
    parent: document.querySelector("#editor"),
  });
  return {
    language,
    session,
    view,
    failure,
    errors,
    snapshots,
    updates,
    committed,
    calls: () => toolingCalls,
  };
}

function rejectUpdate(target, batched) {
  const { view, session } = target;
  view.dispatch(
    setDiagnostics(view.state, [{ from: 0, to: 1, severity: "error", message: "old" }]),
  );
  startCompletion(view);
  if (!batched) {
    session.replaceDocument("2");
    return;
  }
  const first = view.state.update({ changes: { from: 0, to: 1, insert: "2" } });
  const second = first.state.update({ changes: { from: 0, to: 1, insert: "3" } });
  const third = second.state.update({ changes: { from: 0, to: 1, insert: "4" } });
  view.dispatch([first, second, third]);
}

function assertFailed(session) {
  for (const action of [
    () => session.replaceDocument("5"),
    () => session.format(),
    () => session.refreshEnvironment(),
  ]) {
    let caught;
    try {
      action();
    } catch (error) {
      caught = error;
    }
    assert(
      caught?.message === "Editor session has failed",
      "failed operation did not reject explicitly",
    );
  }
}

async function runCase(postcommit, batched) {
  const target = fixture(postcommit, batched);
  const { language, session, view, errors, failure, snapshots, updates } = target;
  rejectUpdate(target, batched);
  assert(
    errors.length === 1 && errors[0] === failure,
    "original failure missing from actual CM sink / nested dispatch",
  );
  assert(updates.join() === (batched ? "2,3" : "2"), "synchronized a transaction after failure");
  assert(
    snapshots.map(({ version }) => version).join() === (batched ? "2" : ""),
    "failed/later notification published",
  );
  if (batched)
    assert(
      snapshots[0] === target.committed[0] && snapshots[0].text === "2",
      "lost exact historical successful snapshot",
    );
  assertFailed(session);
  assert(diagnosticCount(view.state) === 0, "stale diagnostics not cleared after boundary");
  assert(!acceptCompletion(view), "stale completion applied");
  const calls = target.calls();
  startCompletion(view);
  view.dispatch({ changes: { from: 0, insert: "x" } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(target.calls() === calls, "failed tooling performed further requests/publication");
  assert(updates.length === (batched ? 2 : 1), "failed view continued synchronization");
  view.destroy();
  const reattached = new EditorView({
    state: EditorState.create({
      doc: "2",
      extensions: [session.extension, EditorView.exceptionSink.of((error) => errors.push(error))],
    }),
    parent: document.querySelector("#editor"),
  });
  assert(
    errors.at(-1)?.message === "Editor session has failed",
    "failed session reattached silently",
  );
  reattached.destroy();
  session.dispose();
  session.dispose();
  assert(!language.getDocument("memory:///bridge-failure.kalada"), "failed disposal left URI open");
}

export async function runBridgeFailures() {
  for (const postcommit of [false, true]) {
    for (const batched of [false, true]) await runCase(postcommit, batched);
  }
}

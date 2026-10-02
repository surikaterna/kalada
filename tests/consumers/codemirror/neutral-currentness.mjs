import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { diagnosticCount } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorSession } from "@kalada/codemirror/editor";

const assert = (condition, message) => {
  if (!condition) throw new Error(`Neutral currentness: ${message}`);
};
const wait = () => new Promise((resolve) => setTimeout(resolve, 150));
const value = {
  diagnostics: [{ from: 0, to: 3, severity: "error", message: "old" }],
  completion: [{ label: "blue", edit: { from: 0, to: 3, text: "blue" } }],
  hover: { from: 0, to: 3, content: "old hover" },
};

function fixture(async = false, onHover) {
  const pending = {};
  const provider = Object.fromEntries(
    Object.keys(value).map((kind) => [
      kind,
      (request) => {
        if (kind === "hover") onHover?.();
        if (!async) return { ...request.snapshot, value: value[kind] };
        return new Promise((resolve) => {
          pending[kind] = {
            request,
            resolve: () => resolve({ ...request.snapshot, value: value[kind] }),
          };
        });
      },
    ]),
  );
  const session = createEditorSession({
    document: { uri: "fixture:currentness", version: 1, text: "red" },
    provider,
  });
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({ doc: "red", extensions: session.extension }),
    parent,
  });
  view.focus();
  const destroy = () => {
    session.dispose();
    view.destroy();
    parent.remove();
  };
  return { pending, session, view, destroy };
}

export async function runCurrentness() {
  await staleCompletionApply();
  await lateResults();
  await currentAsyncResults();
  await movedHover();
  await reentrantHover();
  await pointerHoverLeave();
}

async function movedHover() {
  for (const action of ["cursor", "selection", "pointer", "leave"]) {
    const { pending, view, destroy } = fixture(true);
    await wait();
    const diagnostics = pending.diagnostics;
    keyboardHover(view);
    const hover = pending.hover;
    if (action === "cursor") view.dispatch({ selection: { anchor: 2 } });
    else if (action === "selection") view.dispatch({ selection: { anchor: 0, head: 2 } });
    else
      view.dom.dispatchEvent(
        new MouseEvent(action === "leave" ? "mouseleave" : "mousemove", {
          clientX: 0,
          clientY: 0,
          bubbles: true,
        }),
      );
    hover.resolve();
    diagnostics.resolve();
    await wait();
    assert(!document.querySelector('[role="tooltip"]'), `${action}-stale hover discarded`);
    assert(
      !diagnostics.request.signal.aborted && diagnosticCount(view.state) === 1,
      `${action} intent change preserves unrelated diagnostics`,
    );
    destroy();
  }
}

async function reentrantHover() {
  const { view, destroy } = fixture(false, () => {
    view.dispatch({ selection: { anchor: 2 } });
    view.dispatch({ selection: { anchor: 0 } });
  });
  keyboardHover(view);
  await wait();
  assert(
    !document.querySelector('[role="tooltip"]'),
    "reentrant moved-and-restored hover rejected",
  );
  destroy();
}

async function pointerHoverLeave() {
  const { pending, view, destroy } = fixture(true);
  await wait();
  const coords = view.coordsAtPos(1);
  view.contentDOM.querySelector(".cm-line").dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: coords.left,
      clientY: (coords.top + coords.bottom) / 2,
      bubbles: true,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 850));
  assert(pending.hover, "public pointer hover requested");
  view.dom.dispatchEvent(new MouseEvent("mouseleave"));
  pending.hover.resolve();
  await wait();
  assert(!document.querySelector('[role="tooltip"]'), "pointer-leave stale hover rejected");
  destroy();
}

async function staleCompletionApply() {
  const { session, view, destroy } = fixture();
  await wait();
  startCompletion(view);
  await wait();
  const option = currentCompletions(view.state)[0];
  assert(typeof option?.apply === "function", "completion apply available");
  session.refreshEnvironment();
  option.apply(view, option, 0, 3);
  assert(session.getSnapshot().text === "red", "environment-stale completion edit rejected");
  startCompletion(view);
  await wait();
  const edited = currentCompletions(view.state)[0];
  session.replaceDocument("new");
  edited.apply(view, edited, 0, 3);
  assert(session.getSnapshot().text === "new", "document-stale completion edit rejected");
  destroy();
}

async function lateResults() {
  const { pending, session, view, destroy } = fixture(true);
  await wait();
  const diagnostics = pending.diagnostics;
  session.refreshEnvironment();
  diagnostics.resolve();
  await wait();
  assert(diagnosticCount(view.state) === 0, "late diagnostic discarded");
  startCompletion(view);
  await wait();
  const completion = pending.completion;
  session.replaceDocument("new");
  completion.resolve();
  await wait();
  assert(currentCompletions(view.state).length === 0, "late completion discarded");
  keyboardHover(view);
  const hover = pending.hover;
  session.dispose();
  hover.resolve();
  await wait();
  assert(!document.querySelector('[role="tooltip"]'), "disposed hover discarded");
  assert(
    [diagnostics, completion, hover].every((entry) => entry.request.signal.aborted),
    "signals aborted",
  );
  destroy();
}

async function currentAsyncResults() {
  const { pending, session, view, destroy } = fixture(true);
  await wait();
  pending.diagnostics.resolve();
  await wait();
  assert(diagnosticCount(view.state) === 1, "current async diagnostics");
  startCompletion(view);
  await wait();
  pending.completion.resolve();
  await wait();
  assert(currentCompletions(view.state)[0]?.label === "blue", "current async completion");
  keyboardHover(view);
  pending.hover.resolve();
  await wait();
  assert(
    document.querySelector('[role="tooltip"]')?.textContent === "old hover",
    "current async plain hover",
  );
  session.refreshEnvironment();
  destroy();
}

function keyboardHover(view) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "H",
      keyCode: 72,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
}

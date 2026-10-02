import { acceptCompletion, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { diagnosticCount } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorSession } from "@kalada/codemirror/editor";
import { runCurrentness } from "./neutral-currentness.mjs";

const assert = (condition, message) => {
  if (!condition) throw new Error(`Neutral browser: ${message}`);
};
const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
const result = (request, value) => ({ ...request.snapshot, value });

export async function runNeutralBrowser() {
  const fixture = createFixture();
  await richTooling(fixture);
  syncFormatting(fixture);
  await asyncFormatting(fixture);
  await partialProviders();
  await runCurrentness();
}

function createFixture() {
  const fixture = {
    mode: "sync",
    pending: null,
    session: null,
    view: null,
    parent: document.createElement("div"),
  };
  fixture.session = createEditorSession({
    document: { uri: "fixture:color", version: 1, text: "😀\r\nred" },
    provider: provider(fixture),
  });
  document.body.append(fixture.parent);
  fixture.view = mount(fixture.session, fixture.parent);
  return fixture;
}

function provider(fixture) {
  return {
    diagnostics: (request) =>
      result(request, [{ from: 4, to: 7, severity: "warning", message: "Color fixture" }]),
    completion: (request) =>
      result(request, [{ label: "blue", edit: { from: 4, to: 7, text: "blue" } }]),
    hover: (request) =>
      result(request, {
        from: 4,
        to: 7,
        content: [{ heading: "Color", text: ["<img src=x onerror=alert(1)>"] }],
      }),
    format(request) {
      const edit = { from: 4, to: request.snapshot.text.length, text: "BLUE" };
      if (fixture.mode === "async")
        return new Promise((resolve) => {
          fixture.pending = { request, resolve: () => resolve(result(request, edit)) };
        });
      if (fixture.mode === "reentrant") {
        fixture.session.replaceDocument("😀\r\nnew");
        return result(request, edit);
      }
      if (fixture.mode === "invalid") return result(request, { ...edit, to: 999 });
      if (fixture.mode === "identity") return { ...result(request, edit), version: 999 };
      return result(request, edit);
    },
  };
}

async function richTooling({ session, view, parent }) {
  await wait();
  assert(diagnosticCount(view.state) === 1, "diagnostics");
  assert(view.contentDOM.getAttribute("aria-label") === "Source editor", "accessibility");
  view.focus();
  startCompletion(view);
  await wait();
  assert(currentCompletions(view.state)[0]?.label === "blue", "completion");
  await wait();
  assert(acceptCompletion(view), "completion apply");
  assert(session.getSnapshot().text === "😀\r\nblue", "UTF16 CRLF completion");
  undo(view);
  assert(session.getSnapshot().text === "😀\r\nred", "history");
  view.contentDOM.focus();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "H",
      code: "KeyH",
      keyCode: 72,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  await wait();
  assert(
    document.querySelector('[role="tooltip"]')?.textContent.includes("<img"),
    "structured hover",
  );
  assert(!parent.querySelector("img"), "safe hover");
}

function syncFormatting(fixture) {
  assert(fixture.session.format() === true, "sync format");
  assert(fixture.session.getSnapshot().text === "😀\r\nBLUE", "format text");
  for (const mode of ["invalid", "identity", "reentrant"]) {
    fixture.mode = mode;
    assert(fixture.session.format() === false, `${mode} rejected`);
  }
}

async function asyncFormatting(fixture) {
  const { session, parent } = fixture;
  fixture.mode = "async";
  for (const invalidate of [
    () => session.replaceDocument("😀\r\nred"),
    () => session.refreshEnvironment(),
    () => fixture.view.destroy(),
  ]) {
    const formatted = session.format();
    invalidate();
    assert(fixture.pending.request.signal.aborted, "cancellation");
    fixture.pending.resolve();
    assert((await formatted) === false, "late format rejected");
  }
  fixture.view = mount(session, parent);
  const current = session.format();
  fixture.pending.resolve();
  assert((await current) === true, "current async format");
  const formatted = session.format();
  session.dispose();
  fixture.pending.resolve();
  assert((await formatted) === false, "dispose currentness");
  fixture.view.dispatch({ changes: { from: 0, insert: "x" } });
  assert(!session.getSnapshot().text.startsWith("x"), "disposed session inert");
  fixture.view.destroy();
  parent.remove();
}

function mount(session, parent) {
  return new EditorView({
    state: EditorState.create({
      doc: session.getSnapshot().text,
      selection: { anchor: 3 },
      extensions: session.extension,
    }),
    parent,
  });
}

async function partialProviders() {
  for (const provider of [
    undefined,
    { hover: (request) => result(request, { from: 0, to: 1, content: "plain" }) },
  ]) {
    const session = createEditorSession({
      document: { uri: "fixture:partial", version: 1, text: "text" },
      provider,
    });
    const view = mount(session, document.body);
    assert(session.format() === false, "optional format");
    startCompletion(view);
    await wait();
    assert(currentCompletions(view.state).length === 0, "optional completion");
    view.destroy();
    session.dispose();
  }
}

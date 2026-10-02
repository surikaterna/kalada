import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorSession } from "@kalada/codemirror/editor";

const assert = (condition, message) => {
  if (!condition) throw new Error(`Neutral reentrancy: ${message}`);
};
const result = (request, text) => ({ ...request.snapshot, value: { from: 0, to: 3, text } });

export async function runReentrancy() {
  await nestedFormat();
  await invalidatedFormat();
  await lifecycleAbort("detach");
  await lifecycleAbort("dispose");
}

function mount(provider) {
  const session = createEditorSession({
    document: { uri: "fixture:abort", version: 1, text: "red" },
    provider,
  });
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({ doc: "red", extensions: session.extension }),
    parent,
  });
  return {
    session,
    view,
    destroy() {
      session.dispose();
      view.destroy();
      parent.remove();
    },
  };
}

async function lifecycleAbort(action) {
  let resolvePending;
  let observed;
  let calls = 0;
  const fixture = mount({
    format(request) {
      calls += 1;
      request.signal.addEventListener(
        "abort",
        () => {
          try {
            observed = fixture.session.format();
          } catch (error) {
            observed = error.message;
          }
        },
        { once: true },
      );
      return new Promise((resolve) => {
        resolvePending = () => resolve(result(request, "obsolete"));
      });
    },
  });
  const pending = fixture.session.format();
  if (action === "detach") fixture.view.destroy();
  else fixture.session.dispose();
  assert(
    action === "detach" ? observed === false : observed?.includes("disposed"),
    `${action} visible to abort listener`,
  );
  assert(calls === 1, "lifecycle abort did not call provider again");
  resolvePending();
  assert((await pending) === false, "lifecycle-aborted response rejected");
  assert(fixture.session.getSnapshot().text === "red", "lifecycle abort made no edit");
  fixture.destroy();
}

async function nestedFormat() {
  let calls = 0;
  let nested;
  let resolveFirst;
  let resolveNested;
  let nestedSignal;
  const fixture = mount({
    format(request) {
      calls += 1;
      if (calls === 1) {
        request.signal.addEventListener(
          "abort",
          () => {
            nested = fixture.session.format();
          },
          { once: true },
        );
        return new Promise((resolve) => {
          resolveFirst = () => resolve(result(request, "first"));
        });
      }
      if (calls === 2) {
        nestedSignal = request.signal;
        return new Promise((resolve) => {
          resolveNested = () => resolve(result(request, "winner"));
        });
      }
      assert(request.signal.aborted, "outer replacement already cancelled");
      return result(request, "obsolete");
    },
  });
  const first = fixture.session.format();
  assert(fixture.session.format() === false, "obsolete outer response rejected");
  assert(fixture.session.getSnapshot().text === "red", "obsolete response did not edit");
  assert(!nestedSignal.aborted, "nested request remains current");
  resolveFirst();
  assert((await first) === false, "first response rejected");
  resolveNested();
  assert((await nested) === true, "nested current response applied");
  assert(fixture.session.getSnapshot().text === "winner", "only winning response edited");
  fixture.destroy();
}

async function invalidatedFormat() {
  let resolveFirst;
  let calls = 0;
  const fixture = mount({
    format(request) {
      calls += 1;
      if (calls === 1) {
        request.signal.addEventListener("abort", () => fixture.session.refreshEnvironment(), {
          once: true,
        });
        return new Promise((resolve) => {
          resolveFirst = () => resolve(result(request, "first"));
        });
      }
      assert(request.signal.aborted, "reentrant refresh cancelled replacement");
      return result(request, "obsolete");
    },
  });
  const first = fixture.session.format();
  assert(fixture.session.format() === false, "invalidated replacement rejected");
  resolveFirst();
  assert((await first) === false, "invalidated original rejected");
  assert(fixture.session.getSnapshot().text === "red", "refresh abort listener made no edit");
  fixture.destroy();
}

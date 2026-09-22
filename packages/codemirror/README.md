# @kalada/codemirror

Thin CodeMirror 6 lifecycle and protocol translation for `@kalada/language-service`.

```ts
const session = createKaladaEditorSession({
  service,
  document: { uri: "memory:///expression.kalada", version: 1, text: "data." },
});
const view = new EditorView({ doc: "data.", extensions: [session.extension], parent });
```

One session exclusively owns one open URI and at most one attached view. Text-changing transactions,
including undo and redo, become monotonic language-service revisions. `replaceDocument`, `format`,
`refreshEnvironment`, and `dispose` preserve request identity and stale/cancellation checks. Dispose is
idempotent; destroying a view detaches it without closing the session.

CodeMirror packages are peers so consumers use one set of state classes. This package has no parser,
schema traversal, inference, evaluation, filesystem, or network behavior. Tooltips use DOM text nodes,
and the extension includes keyboard completion, keyboard hover, Escape handling, and accessible labels.

# @kalada/codemirror

Reusable CodeMirror 6 lifecycle and tooling integration, with a backward-compatible Kalada facade.

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

### Kalada bridge failures

The bridge assumes exclusive ownership of its URI and a truthful, synchronous `getDocument`.
If a detached update throws, it rethrows the original error and does not notify for that attempt.
When the service still exactly matches the previous URI/version/text and no neutral snapshot change
intervened, the provisional snapshot is restored. When the service matches the latest neutral snapshot
(including committed nested edits), that state remains usable. Successful descendants retain FIFO
notifications with their exact historical service snapshots. Unmatched or unobservable state makes
the session terminally failed; intervening environment refreshes or edits are never rolled back.

An attached bridge exception is always terminal, even after a service commit: CodeMirror cannot undo
its view update and may disable the throwing plugin. The original exception is reported through
CodeMirror's exception sink (`EditorView.exceptionSink`); `view.dispatch` need not throw. Subsequent
replacement, formatting, environment refresh and attachment explicitly fail. Tooling is invalidated
without dispatch inside the plugin update; presentation cleanup runs after the update boundary.
Earlier successful transactions in a batch still notify, but the failed and later transactions do not.
No further service synchronization or tooling publication occurs, and disposal remains idempotent.
There is no retry, compensating update, or close/reopen recovery. Arbitrary lying/proxy services and
transactional redesign are outside this bounded contract.

CodeMirror packages are peers so consumers use one set of state classes. This package has no parser,
schema traversal, inference, evaluation, filesystem, or network behavior. Tooltips use DOM text nodes,
and the extension includes keyboard completion, keyboard hover, Escape handling, and accessible labels.

## Language-neutral entry point

```ts
import { createEditorSession, type EditorProvider } from "@kalada/codemirror/editor";
import { EditorView } from "@codemirror/view";

// Independent color fixture: no Kalada language-service contracts.
const provider: EditorProvider = {
  diagnostics: ({ snapshot }) => ({
    ...snapshot,
    value: snapshot.text === "red" ? [] : [
      { from: 0, to: snapshot.text.length, severity: "warning", message: "Expected red" },
    ],
  }),
  completion: ({ snapshot }) => ({
    ...snapshot,
    value: [{ label: "red", edit: { from: 0, to: snapshot.text.length, text: "red" } }],
  }),
  hover: ({ snapshot }) => ({
    ...snapshot, value: { from: 0, to: snapshot.text.length, content: "A color" },
  }),
  format: ({ snapshot }) => ({
    ...snapshot, value: { from: 0, to: snapshot.text.length, text: snapshot.text.trim() },
  }),
};
const session = createEditorSession({
  document: { uri: "memory:///color.txt", version: 1, text: "red" }, provider,
  ariaLabel: "Color source", onDocumentChange: (snapshot) => console.log(snapshot.text),
});
const view = new EditorView({ doc: session.getSnapshot().text, extensions: session.extension, parent });
const didFormat = await session.format();
```

`EditorSessionOptions` accepts `document`, optional `provider`, `ariaLabel`, presentation `extensions`,
and `onDocumentChange`. `EditorSession` exposes `extension`, `getSnapshot`, `replaceDocument`,
`refreshEnvironment`, `format`, and `dispose`. Each provider capability is optional; no provider is
required for editing/history. Neutral sessions own their snapshots, not a compiler's open-document store.
The Kalada facade still owns its language-service URI, callback snapshots and synchronous `format(): boolean`.

Providers receive `{ snapshot, signal }` plus a source offset for completion/hover. Return `null` or
`{ uri, version, environmentGeneration, value }`, synchronously or as a native Promise. Tag results
with the **captured request snapshot**, never a later snapshot. `format()` returns `boolean` for sync
providers and `Promise<boolean>` for async providers (false if absent, detached, invalid or stale).
Rejected promises are discarded; synchronous provider exceptions remain visible to callers/CodeMirror.
Signals abort superseded feature requests and requests invalidated by edits, environment refresh,
detach or disposal. Identity is rechecked after provider return and immediately before completion apply.
Call `refreshEnvironment()` whenever external catalogs, bindings or admission evidence change.
Providers should return immutable result payloads and honor cancellation to avoid wasted work.
Neutral completion providers own candidate filtering and ordering; CodeMirror does not re-filter
those results against replacement text. The Kalada facade retains its existing fuzzy filtering/boosts.

Diagnostics are animation-frame scheduled. Returned ranges and edits must be ordered, bounded,
half-open **UTF-16 source offsets**, including CRLF, and may not split CRLF or surrogate pairs.
Invalid entries are dropped and invalid formatting edits return false. Editing uses the document's
detected line separator; replacement can switch it. Use consistently separated documents (mixed
line endings are not supported losslessly). Hover accepts plain text or `{ heading, text: string[] }`
sections, never HTML. Consumers may supply trusted CodeMirror presentation extensions, but these
do not determine embedded routing. One session attaches to at most one view; view destruction permits
reattachment with the current text. Disposal does not destroy the host's view; later view edits are inert
with respect to the disposed session. Host change-callback exceptions are isolated.

The neutral runtime and declaration graph imports only CodeMirror, not Kalada language contracts,
parsers, ASTs or component catalogs. The package retains its language-service dependency for the legacy
root entry: subpath isolation is not a claim that npm omits that dependency. Packed smoke runs ESM/CJS,
declaration checking and neutral browser bundling with the Kalada language packages removed.

## Formbar FSX: diagnostics first, runtime still explicitly applied

Formbar's `@formbar/fsx-authoring` provides `compileFsx(source, options)`, **not** a complete tooling
language service. An FSX host can supply just diagnostics initially:

```ts
import { compileFsx } from "@formbar/fsx-authoring";
import { createEditorSession, type EditorProvider } from "@kalada/codemirror/editor";

const provider: EditorProvider = {
  diagnostics: ({ snapshot, signal }) => {
    const compiled = compileFsx(snapshot.text, authoringOptions());
    if (signal.aborted) return null;
    return { ...snapshot, value: toEditorDiagnostics(compiled) };
  },
};
```

This is integration guidance, not a shipped Formbar adapter. `authoringOptions` is host-owned renderer,
binding and admission evidence; `toEditorDiagnostics` is a host adapter over the installed compiler's
actual result schema, producing `{ from, to, severity, message }`. Preserve its half-open UTF-16 offsets;
do not convert them to code-point indexes or normalize CRLF first. The host's existing **Apply** action
should compile/apply `session.getSnapshot().text` separately. Diagnostic requests must not mount a
renderer or change runtime state. On catalog/evidence changes, update host options and refresh the session.
FSX owns attribute guest slots: any future completion/hover/format adapter must route through those
slots with captured host/guest identity and map returned edits back to host source. This editor neither
extends the v1 diagnostic-routing protocol into a full language service nor supplies production FSX completion.

## Projection and future UPDF

The existing projection representation is an AST/data JSON API, not a new textual grammar. A consumer
may edit a serialized structured representation using its chosen JSON tooling and validate against the
actual projection API. Serialization, parse validation, AST conversion and explicit application belong
to that consumer; this package does not invent a projection syntax.

UPDF integration needs an agreed declarative syntax/parser and tooling provider before completion,
hover or formatting can be promised. Component catalogs and runtime evaluation stay outside the editor.
Embedded routing belongs to the host-language adapter; optional syntax highlighting is presentation only.

# #78: Completion, hover, and the thin CodeMirror boundary

- Status: **PROPOSED**, written architecture only; no API below marked proposed exists yet.
- Parent: [GitHub #78](https://github.com/surikaterna/kalada/issues/78).
- Baseline: `origin/main` `82ccbf6c90a131b95826ccf6594a438d190b48fe` (#73/#76/#77 merged).
- Authority: [ADR-0006](../adr/0006-prepared-execution-schema-tooling.md).
- Decisions/amendments: [overview](./0078-0079-editor-demo-decisions.md).
- Consumer, not dependency: [#79 Scheman demo](./0079-scheman-demo-workspace.md).

## Objective and scope boundaries

Add useful schema-neutral tooling without creating a second language implementation. Extend headless
`@kalada/language-service`; publish **`@kalada/codemirror`** in `packages/codemirror`. Manual normalized
host graphs are the only conformance fixtures needed. #77 is merged, so #78 is Ready, not blocked by
#75, #76, #81, or #87. Do not add evaluation, modules, imports, a second parser/inference implementation,
JSON-RPC/LSP, vendor imports, a demo, workers, a release, or changes to PR #63. No direct-CDN claim.

## Existing public contracts: compatibility evidence

Read these actual main files before implementation:

- [service contracts](../../packages/language-service/src/contracts.ts),
  [service](../../packages/language-service/src/service.ts),
  [document store](../../packages/language-service/src/documents.ts),
  [line index](../../packages/language-service/src/line-index.ts).
- [syntax exports](../../packages/syntax/src/index.ts),
  [public types](../../packages/syntax/src/public-types.ts),
  [CST/tokens](../../packages/syntax/src/cst-types.ts),
  [parser](../../packages/syntax/src/parser.ts),
  [lowering](../../packages/syntax/src/lower.ts),
  [dispatch](../../packages/syntax/src/dispatch.ts).
- [host environment](../../packages/host/src/contracts.ts),
  [graph types](../../packages/host/src/editor-types.ts),
  [manual fixtures](../../packages/host/src/manual-provider.test.ts).

Existing signatures (abridged only in generic type parameters, not call/envelope shape):

```ts
createLanguageService(initial: EnvironmentUpdate): LanguageService
// EnvironmentUpdate = { generation: number; description: DescribeEnvironmentResult }
service.openDocument({ uri, version, text }): DocumentSnapshot
service.updateDocument({ uri, version, edits }): DocumentSnapshot
service.closeDocument(uri: string): DocumentSnapshot
service.analyze(uri: string, options?: RequestOptions): AnalysisOutcome
service.diagnostics(uri: string, options?: RequestOptions): DiagnosticsOutcome
service.format(uri: string, options?: RequestOptions): FormatOutcome
service.updateEnvironment(input: EnvironmentUpdate): EnvironmentSnapshot
service.isCurrent(identity: SnapshotIdentity): boolean
// RequestOptions = { cancellation?: { isCancellationRequested(): boolean } }
// SnapshotIdentity = { uri: string; version: number; environmentGeneration: number }
// Outcomes contain kind + identity + status: "current" | "stale".
```

They capture the **current open** document, not an arbitrary requested historical version. Versions
and generations are non-negative safe integers; monotonic high-water marks survive close/reopen.
Edits are half-open UTF-16 line/character ranges against **one old snapshot**, atomically applied.
Do not change these methods to positional version arguments, async methods, offset ranges, or LSP
text document envelopes. Result status describes return time; `isCurrent` is the publication authority.
`LanguageAnalysis` has optional syntax/environment/program/sourceMap, **not** resultType or evaluator.

`parseKaladaV1Expression(source, options?)` returns `KaladaParseResult` with document tokens/expression
and diagnostics even for incomplete source. Token ranges are UTF-16 offsets. A recovered
`field-access` contains target, optional, operatorToken, fieldToken/null, field/null. `user.` already
has the necessary recovered field node: do not parse a made-up repaired expression in the service.
Public lowering returns `{ok:true, program, sourceMap, resultType}` or diagnostics; parse diagnostics
currently prevent whole-document lowering. Whole-expression resultType is insufficient for subtree hover.
Baseline host `parseExpression` returns diagnostics without a parsed artifact on syntax failure, and
LS `analyze` therefore omits `analysis.syntax` then. Completion/hover must call the existing public
syntax parser directly on their captured text to retain recovery CST; reusing analyze alone will fail
on `user.`. This is reuse of the authoritative parser, not a second parser or a repair pass.

## PROPOSED headless API (unit #78-L)

Add these methods to `LanguageService`, retaining the exact existing capture/cancel/currentness model:

```ts
completion(uri: string, position: Utf16Position, options?: RequestOptions): CompletionOutcome
hover(uri: string, position: Utf16Position, options?: RequestOptions): HoverOutcome

type CompletionOutcome = CompletionResult | CancelledResult;
type HoverOutcome = HoverResult | CancelledResult;
interface CompletionResult extends SnapshotIdentity {
  readonly kind: "completion";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly items: readonly CompletionItem[];
  readonly incomplete: boolean;
  readonly evidence: readonly ToolingEvidence[];
}
interface HoverResult extends SnapshotIdentity {
  readonly kind: "hover";
  readonly status: ResultStatus;
  readonly diagnostics: readonly LanguageServiceDiagnostic[];
  readonly hover: HoverInfo | null;
  readonly incomplete: boolean;
  readonly evidence: readonly ToolingEvidence[];
}
```

The remaining **proposed plain data types** are fixed as follows (readonly/deep-frozen throughout):

- `ToolingEvidence`: `{code, path}` where path is `HostPath`; code is host `EditorUnknownCode` or
  `"unsupported-source-path" | "semantic-unknown" | "query-limit" | "opaque-wrapper"`.
- `CompletionItem`: `{label: string, kind: "binding"|"property"|"operator", edit: TextEdit,
  support: "common"|"conditional", presence: "required"|"optional"|"unknown",
  branches: readonly string[], evidence: readonly ToolingEvidence[]}`. Branch IDs are request-local
  graph-edge paths, never stable fingerprints. No callbacks, markdown, runtime value, or HTML field.
- `HoverInfo`: `{range: Utf16Range, input: readonly ShapeSummary[],
  output: {type: KaladaSyntaxStaticType, known: boolean},
  access: "supported"|"conditional"|"unsupported", evidence: readonly ToolingEvidence[]}`.
- `ShapeSummary`: `{kind: EditorNode["kind"], path: HostPath,
  presence: "required"|"optional"|"unknown", branches: readonly string[],
  fields: readonly {name: string, presence: "required"|"optional"|"unknown",
  accessible: boolean}[], provenance: readonly {providerId: string, providerVersion?: string}[]}`.
  Scalar names may be added as `scalar?: EditorScalarName`; no arbitrary annotations/metadata copying.
  Field lists include non-source-addressable keys with `accessible:false` for inspection only.

Add `"completion"|"hover"` to `LanguageServiceOperation`; add tooling checkpoints
`"context"|"before-query"|"after-query"` to the existing union. Reuse `captured`, `environment`,
`before-parse`, `after-parse`, `complete`. Check cancellation at each checkpoint and every 64 graph
visits. Return only `CancelledResult` on cancellation, never partially committed items. Invalid position
uses existing `INVALID_RANGE`; invalid URI/unopened document uses existing errors. Empty results are
ordinary current results with identity and evidence. No hidden analysis cache or callbacks invoked.

## PROPOSED narrow syntax semantic query (accountable unit #78-S)

The baseline exports no operator/subtree query. Add `queryKaladaV1Semantics` and public result types
in `packages/syntax/src/{public-types,index}.ts`; implement in a cohesive `semantic-query.ts`, extracting
shared inference helpers from lower/dispatch as necessary without changing language behavior:

```ts
queryKaladaV1Semantics<R extends JsonValue = string>(
  parsed: KaladaParseResult, options?: KaladaLowerOptions<R>
): KaladaSemanticQueryResult
// { nodes: readonly KaladaSemanticNodeInfo[];
//   diagnostics: readonly KaladaSyntaxDiagnostic[]; incomplete: boolean }
// Node info: { range: KaladaSourceRange; type: KaladaSyntaxStaticType;
//   known: boolean; fieldAccess: { plain: Support; optional: Support };
//   operators: readonly { operator: KaladaBinaryOperator; support: Support }[] }
// Support = "supported" | "conditional" | "unsupported"
```

Validate parse-result provenance and reference options as lowering does. Query every complete subtree
under syntax's existing limits, retaining internal `StaticOption` until final projection. Share the
same literal/reference/field/unary/binary/conditional dispatch as lowering; never maintain parallel
inference. Failed/unknown nodes yield `known:false`, dynamic, and diagnostics rather than fictitious
nested types. A child independent of a recovery error may have facts even when the parent cannot lower.
For operators, use actual complete operands when present; at a postfix completion point the missing
right operand makes support conditional, not proven. If known operands reject dispatch, report
unsupported. Dynamic operands do not become a guessed number/string domain. Preserve parser restrictions
(relational chaining, coalesce/logical mixing) in completion context; dispatch support alone is not
proof the surrounding source is legal. Query remains data-only and never calls host/core evaluation.

Tests must compare every returned complete-node type and operator decision against existing lowering
and dispatch fixtures, including dynamic, Option(dynamic), temporal domains, callable equality rejection,
conditional joins, failed field access, and incomplete parents. Complete source behavior before/after
extraction must be identical. This is an additive minor syntax release, not permission to add syntax.

## Cursor, replacement, scope, and fallback invariants

1. Capture once; convert position with the captured line index. Traverse public CST iteratively to
   the narrowest containing node; use token indices/ranges to disambiguate cursor at token boundaries.
   Completion at token end belongs to that identifier/field; hover requires a nonempty token range.
2. At a reference prefix replace the **whole identifier token**, not just the prefix before cursor.
   At a field prefix replace only the field token, leaving dot/optional-dot and trivia intact.
   For null field after `user.` insert at the cursor (zero-width), provided only whitespace separates
   cursor from the operator. Never consume the following operator, quote, CR, or LF.
3. Root names come from normalized compile bindings, resolved by exact name/ID. There is no local
   declaration/lambda CST and thus **no local bindings/shadowing to infer**. Do not scan `let`, `=>`, or
   object keys into scope. Host rejects duplicate names; unsupported would-be shadowing stays invalid.
4. Follow only reference -> group -> field-access chains with exact identifier field names. For a
   conditional target, retain then/else alternatives separately without evaluating its condition.
   Do not infer runtime discriminants or drop one side. A root expression with no chain has no shape
   path unless it is one of those structural cases. Semantic hover can still use the syntax query.
5. Brackets/indexing, quoted keys, function calls, and comments are unsupported at baseline. Lexer
   marks comment-like regions unsupported; suppress completion inside those token ranges and strings,
   including unterminated strings. Do not offer bracket syntax for arrays/tuples or `obj."key"`.
   Keyword-shaped fields accepted by syntax (such as `obj.true`) are allowed; binding keywords are not.
   Decide insertion legality using syntax token/parser contracts, not a second identifier lexer.
6. Conservative fallback: environment bindings only in a proven reference/empty-expression position;
   properties only for a recovered field node with a resolvable target; no scanning backwards across
   errors or statement-like unsupported tokens. Unknown context returns empty + evidence, not guessing.
7. Ranges are zero-based UTF-16, including astral code units. Reject edits that would split a surrogate
   pair in a candidate replacement; preserve all unrelated text. Do not normalize CRLF or silently map
   an interior CRLF offset to a different edit. Hover uses complete token range. Include cursor-before,
   inside, and after astral text, CRLF boundaries, combining characters, EOF, and multiline fixtures.

## Bounded graph query, not inference

Consume `NormalizedEnvironment.editorGraph`: nodes/roots/definitions are document-local, immutable,
with `EditorEdge.nodeId/path/cycle` and node availability/evidence. Build an instance/request-local
node index, never a global cache. Default/hard tooling caps: 32 path-expansion depth, 4096 state visits,
256 emitted items and 256 summary fields; all limit hits set `incomplete` and `query-limit` evidence.
These are safety limits, not measured performance promises. Visit states include `(nodeId, remaining
path, branch path)`; detect ancestor re-entry and bound all alias/ref/union/intersection expansion.
Never recursively expand arbitrary metadata or access runtime data.

| Graph case | Query rule |
| --- | --- |
| reference/definition aliases | Follow resolved target, preserve source edge path; unresolved is an unknown branch, not absent. |
| object | Exact named properties only; preserve presence (explicit presence wins over required boolean), requiredNames and unknown-key evidence. Do not invent keys from additionalProperties. |
| array/tuple | Inspect element/items/rest summaries within bounds; no numeric source path insertion or implicit element-to-object flattening. |
| union / conditional target | Retain every viable alternative. `never` alone is provably nonviable. Unknown, opaque, unavailable, unresolved, or truncated alternatives remain viable unknowns. |
| intersection | Combine constraints without assuming satisfiability. Show all contributing operand provenance; common access requires every operand to affirm it. Fields found in only one operand are conditional, even though a richer solver might prove more. |
| wrapper | Unwrap structural readonly/brand/optional/nullable/default/catch while retaining wrapper and presence evidence; nullable/optional introduce a viable non-object/missing alternative. Pipeline/effect/coerce/unknown wrappers remain uncertain and never guarantee output access. |
| record/enum/literal/scalar | Enumerate only proven finite string keys with input evidence; otherwise summarize. Never derive semantic type from these nodes. |
| cycles/limits | Preserve a visible unknown branch at cutoff. Independent paths to one node retain their distinct provenance. No infinite alias loops. |

Deduplicate items by `(kind, edit.range, edit.text)`; merge sorted branch/evidence sets, not overwrite
a less certain entry. Sort common before conditional, then kind (binding/property/operator), then label
by UTF-16 code-unit comparison, then edit text and branch path; never localeCompare/object enumeration
order. A candidate is common only if **ALL viable branches affirm support**. Unknown or truncated
branches prevent common classification globally for that query. Required only when all supporting
branches require; mixed optional is optional, any unknown presence is unknown. “Common” is structural
agreement, not a guarantee of presence/validation/compilation. Unsupported syntax is never inserted.

## Hover and semantic separation

Use separate labeled sections: **Input editor shape**, **Output Kalada semantic projection**,
**Presence / branch conditions**, and **Limit/unknown evidence**. Known binding semanticType and syntax
query facts alone govern operators/access. A JSON object's nested number-shaped field commonly still
has dynamic syntax type; `?.` may project an unknown Option payload to dynamic. Never fabricate nested
Kalada records, Option from optionality, Instant from date strings, or a union-to-json widening.

Input shape may be before a transforming validator/codec. Always label it input, never output truth.
Known inaccessible semantic targets get no property insertion; conditional access may get explicitly
conditional shape suggestions. Hover on existing invalid access can still explain the mismatch. No
raw sourceId, schema descriptions, arbitrary constraints, host path secrets, callbacks, or runtime
values enter tooltips. Paths are workspace-relative binding/graph paths with bounded string segments;
provenance is provider ID/version only, not provider `source` URLs/paths.

## PROPOSED @kalada/codemirror API and lifecycle (#78-C)

```ts
createKaladaEditorSession(options: {
  service: LanguageService;
  document: DocumentOpen;
  onDocumentChange?: (snapshot: DocumentSnapshot) => void;
}): KaladaEditorSession
// session.extension: import("@codemirror/state").Extension
// session.refreshEnvironment(): void
// session.replaceDocument(text: string): void
// session.format(): boolean
// session.dispose(): void
```

One session owns one service-open URI and at most one attached EditorView. It opens on creation;
creation with an already-open URI fails rather than adopting ambiguous ownership. First view text
must equal the opened text. Dispose is idempotent, cancels work, removes listeners/tooltips, and closes
the document exactly once. Destroying/detaching its view clears view tasks but leaves the session open
until explicit dispose (needed for tabs). Workspace owns the shared service/environment, not the adapter.
`onDocumentChange` reports immutable snapshots; application exceptions cannot roll back a committed edit.

- Translate each document-changing CM transaction's `changes.iterChanges` **old** fromA/toA coordinates
  via that transaction's start document; ranges must refer to the matching old LS snapshot. Process a
  batch's transactions sequentially, one monotonic revision each, not mixed offsets from different
  start states. If line endings/coordinates cannot round-trip, send one old-snapshot whole-document
  replacement. Same-position inserts are coalesced before submission, not overlapping edits.
- Revision = service high-water + 1 for every text change, including undo/redo and external replacement.
  Selection-only transactions do not increment. Exhausting safe integers is a visible session error.
  Imported historical versions never reset a live URI. Replacement/format go through CM dispatch so
  there is exactly one LS update; never mutate both LS and CM independently. Format is one undo step.
- `format()` captures the current result, verifies status/currentness/session/view epoch, then applies
  its edit. Return false for no edit/cancelled/stale. `replaceDocument` resets selection safely, cancels
  requests and dispatches a whole-document edit; when detached it updates both retained state and LS.
- Environment owner calls `service.updateEnvironment` once, then `refreshEnvironment()` on sessions.
  Refresh invalidates displayed diagnostics/completions/hover and requests new ones without text edits.
- Diagnostics/completion/tooltip requests forward cancellation and identity. Their publication/apply
  closures check `kind`, `status`, `service.isCurrent`, session/view epoch and request sequence. Hover
  additionally captures selection/pointer intent so a moved cursor cannot publish an obsolete tooltip.
  Completion apply must recheck identity, not trust CM's matching text alone; never use an unrestricted
  `validFor` cache across environment revisions. Abort/destroy cancels pending jobs before any render.
- Adapter schedules diagnostics once per animation frame (coalesce only); demo debounce belongs to app
  orchestration. CM owns its own completion interaction. No evaluation debounce or schema traversal here.

Render tooltips with `textContent`/text nodes and semantic headings/lists, no innerHTML or markdown
renderer. Use CM tooltip/completion/lint facilities and keymaps: keyboard completion, arrows, Enter,
Escape, focus restoration, explicit accessible labels and a keyboard-triggered hover command. Do not
rely on color or pointer-only affordances. No DOM/editor imports in core, host, syntax, or language service.

Peer dependencies: CM 6 `@codemirror/state`, `view`, `autocomplete`, `lint`, `commands`, with matching
pinned dev dependencies for tests; keep them external in tsup ESM/CJS builds to avoid duplicate state
classes. `@kalada/language-service` is a normal runtime dependency; host types should be type-only where
possible. Host diagnostics have no severity property: translate them to CM error severity without
inventing a headless severity contract. No full `codemirror` umbrella, vendor, React, or bundled CM
copies. Mirror existing minimal package exports/files/sideEffects conventions and emit .js/.cjs/.d.ts/.d.cts; no browser condition or
engine policy change in anticipation of #81. Test Node import without creating a view; actual view use
requires a browser. No top-level DOM access introduced by our adapter.

## Decomposition, exact targets, dependencies, and acceptance

| Unit | Why / exact targets | Dependencies | Acceptance / evidence; exclusions |
| --- | --- | --- | --- |
| #78-S | Supply authoritative semantic query: syntax `public-types.ts`, `index.ts`, new `semantic-query.ts`, shared lower/dispatch helpers and tests. | merged #77 baseline | Type/dispatch parity, complete/incomplete subtree tests, packed API types; no new grammar or core semantics. |
| #78-L | Deliver headless vertical slice: LS `contracts.ts`, `service.ts`, `index.ts`; new `cursor-context.ts`, `graph-query.ts`, `completion.ts`, `hover.ts`, fixture/tests. | S | Manual refs/aliases/cycles/union/intersection/wrapper/array/tuple tests; all-branch common rule, truncation, stable ordering, UTF-16 edits, cancellation at every checkpoint, environment/document reentrancy races; no vendor or evaluation. |
| #78-C | Deliver usable editor: new `packages/codemirror/{package.json,tsup.config.ts,README.md,src/*}` with lifecycle/translation/rendering tests. | L | Multi-edit/undo/redo/replace/format/refresh/dispose parity with direct service; no traversal/parser/inference; keyboard/escaping tests; no demo. |
| #78-P | Prove publishing and browser boundaries: `scripts/codemirror-package-smoke.ts`, `tests/consumers/codemirror/*`, existing architecture tests and LS/syntax smoke fixtures, root scripts. | C | Packed Node ESM/CJS, .mts/.cts consumers, release-workspace rewrite, real Chromium EditorView fixture using manual provider only, dependency graph/metafile and network trace; no publication/CDN claim. |

Required test sources include `user.`, `user.na`, `(user).name`, `user?.name`, valid keyword fields,
`user[0]`, `user."a-b"`, unsupported comment regions, local-looking invalid forms, missing refs,
transformed-input mismatch, union object+unknown and object+never, cyclic aliases, and conditional roots.
Test forged callbacks are never invoked by completion/hover. Compare adapter edits/hover text/diagnostics
to direct LS results, not just screenshots. Browser fixture must mount a real EditorView, type, accept
completion, open keyboard hover, apply formatting, undo, change environment, and dispose during pending
work. Existing Node browser-runner smoke alone is not evidence of a real DOM/editor interaction.
Use Playwright Chromium for this fixture, with Playwright pinned as a root development-only dependency
and its matching browser installed by the test environment (`bunx playwright install chromium`). The
smoke script owns a local static server and browser teardown; no Playwright dependency is published.

## Validation and handoff

Implementation commands (not required for writing this plan):

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run syntax:smoke
bun run language-service:smoke
bun run language-service:browser-smoke
bun run package:smoke
bun run codemirror:smoke          # PROPOSED root script, packed consumers
bun run codemirror:browser-smoke  # PROPOSED root script, real Chromium
bun run changeset:check
git diff --check
```

Use `scripts/language-service-package-smoke.ts` and `scripts/smoke-release-workspace.ts` as conventions,
not hardcoded assumptions about future release numbers. Add **minor Changesets** for syntax,
language-service, and new @kalada/codemirror. Tests/docs alone require none; this architecture branch
requires none. Record no-vendor packed fixture and no-DOM headless import evidence explicitly.

**Risks / decisions requiring Builder acknowledgement:** array/index/local grammar is not implemented;
accept the scoped structural-inspection amendment rather than silently widening syntax. The semantic
query is necessary additive API work with exhaustive-union consumers potentially needing new cases;
document the new operation/checkpoint variants. Package policy may change after #81; follow accepted
main at implementation time, not unmerged ADR-0007. Resource bounds are defensive, not responsiveness
guarantees; #87 owns measured optimization. Graph uncertainty must remain visible, not convenient filtering.

**Fresh-model entry:** read this plan, actual linked contracts, and overview amendments. Engineer starts
`feature/78-language-completion-codemirror` in `./trees/78-language-completion-codemirror` from then-current
main after Builder records approval in #78. Reconcile drift from the exact baseline before coding.
Implement S -> L -> C -> P with focused commits and no extra scopes. Keep production files <=400 lines,
functions <50 lines, nesting <=3; self-check Universal PR Checklist. Attach commands and fixture evidence
to #78 before `implemented`. Auditor checks the same checklist and all table rows, then `verified` or
`changes_requested`. Diplomat handles PR `in_review` and merge/closure; #79 remains blocked until merge.
New gaps get child/follow-up issues linked to #78; do not claim this architecture implemented the feature.

# #79: Scheman-first demo workspace and live inspectors

- Status: **PROPOSED**, not implemented or maintainer-accepted.
- Parent: [GitHub #79](https://github.com/surikaterna/kalada/issues/79).
- Exact baseline: `origin/main` `82ccbf6c90a131b95826ccf6594a438d190b48fe`.
- Authority: [ADR-0006](../adr/0006-prepared-execution-schema-tooling.md).
- Dependency decision: [overview and exact amendments](./0078-0079-editor-demo-decisions.md).
- Editor contract: [#78 plan](./0078-completion-hover-codemirror.md), **must merge first**.

## Objective, dependencies, and scope

Deliver a private **`apps/demo`** package: **Vite + TypeScript + plain DOM + CodeMirror 6**. No UI framework
is justified for this initial workspace. Use `@kalada/host`, `@kalada/language-service`,
`@kalada/codemirror`, `@kalada/adapter-scheman`, public `@scheman/core`, and the explicit validator below.
Use public `@kalada/syntax` for recovery CST inspection, and public core value types for DTO visitors.
Root workspaces gain `apps/*` only during implementation. No umbrella import or heavyweight core feature.

Required DAG is **#73 + #76 + #78**, replacing the issue body's obsolete #75 requirement. #73/#76 are
merged; #79 stays blocked until #78 merges. #75 is deliberately deferred, not secretly implemented in
this app. #80 owns deployment/comprehensive E2E. #81/PR #82 remain open; ADR-0007 is not accepted authority
at this baseline. #87 owns later measured sizing/compute review and is not a new gate for the demo.

Out of scope: modules/cross-file evaluation (#21), async host (#74), Standard adapter (#75), Zod, external
schemas, arbitrary JSON Schema compatibility, schema JavaScript, network resolver, server, telemetry,
workers as a requirement, direct CDN/import maps, deployment, publication, and release PR #63.

## Baseline APIs and validation truth

Sources to read, not private APIs to import:

- [Scheman adapter types](../../packages/adapter-scheman/src/types.ts),
  [README](../../packages/adapter-scheman/README.md),
  [execution integration](../../packages/adapter-scheman/src/execution-integration.test.ts).
- [host environment](../../packages/host/src/contracts.ts),
  [execution contracts](../../packages/host/src/execution-contracts.ts),
  [compile](../../packages/host/src/compile-expression.ts),
  [link](../../packages/host/src/link-expression.ts).
- [LS contracts](../../packages/language-service/src/contracts.ts),
  [syntax public types](../../packages/syntax/src/public-types.ts).
- Public [@scheman/core 2.0.0 declarations](https://unpkg.com/@scheman/core@2.0.0/dist/index.d.ts),
  [JSON provider source](https://github.com/spralle/scheman/blob/main/packages/core/src/providers/json-schema/index.ts),
  [ingestion source](https://github.com/spralle/scheman/blob/main/packages/core/src/ingest-document.ts).
  Upstream main links explain implementation; released declarations and the locked package are the
  compatibility authority. Recheck the packed dependency at implementation, not an assumed future API.

Existing public signatures and fields:

```ts
ingestSchemaDocument(schema: unknown, options: IngestDocumentOptions): IngestDocumentResult
// options = { provider: SchemaDocumentProvider; limits?: LimitOptions }
// result = { document: SchemaDocument; validator?: StandardSchemaV1 }
jsonSchemaProvider(options?: { dialect?: "draft-07" | "draft-2020-12" }): SchemaDocumentProvider
adaptSchemanDocument(options: AdaptSchemanOptions): AdaptSchemanResult
parseExpression(source: string, options?: HostParseOptions): ParseExpressionResult
compileExpression(parsed: ParsedExpression, projection: HostCompileProjection,
  options?: HostCompileOptions): CompileExpressionResult
linkExpression(compiled: CompiledExpression, environment: NormalizedEnvironment,
  capabilities: CapabilitySnapshot): LinkExpressionResult
// On success HostResult<T> is {ok:true, value:T}; failure has diagnostics.
prepared.evaluate(values: unknown): HostResult<KaladaValue>
createLanguageService(initial: EnvironmentUpdate): LanguageService
```

`SchemaDocument` has `formatVersion:1`, `root.input/output`, `nodes`, `definitions`, `metadata`,
`capabilities.input/output`, and `diagnostics`. Scheman's JSON provider walks the same JSON schema on
both sides; side node IDs need not be equal. `ingestSchemaDocument` retains a validator only when its
**input already is a Standard Schema validator**. JSON text supplies none. There is no public generator
in the inspected v2 index/declarations. `checkType` is not a JSON Schema validator. Do not claim either
validation or generation from ingestion.

`adaptSchemanDocument` takes one binding `{id,name,path}`, explicit mode/provider identity, the document,
and optional validator/codec options. Success exposes `environment`, `capabilitySnapshot`, diagnostics,
and optional retainedValidator. It is structurally usable as a successful `DescribeEnvironmentResult`;
extra adapter diagnostics are shown separately, not cast to host diagnostics. Failure requires an
app-owned safe environment error envelope for LS (see failure UX below).

## Deliberate validator selection and strict schema admission (#79-V)

Select **`@cfworker/json-schema` 4.1.1**, an independent interpreting JSON validator, not #75. Its
[published manifest](https://unpkg.com/@cfworker/json-schema@4.1.1/package.json) has ESM/CJS/types and no
runtime dependencies; its [published Validator](https://unpkg.com/@cfworker/json-schema@4.1.1/dist/esm/validator.js)
constructs a dereference lookup then calls the interpreter. Its
[README](https://github.com/cfworker/cfworker/tree/main/packages/json-schema) explicitly motivates lack
of code generation/eval in Workers. Use `new Validator(privateSchemaCopy, "2020-12", true)` and
`validate(value): {valid:boolean, errors: OutputUnit[]}`. No `addSchema`, custom formats, or resolver.
This is a justified dependency choice, **not yet browser-conformance evidence**. #79-V must prove the
pinned packed transitive graph and supported fixtures in CSP without unsafe-eval before dependent units.

Reject Ajv runtime compilation because editable browser schemas would require dynamic code. Build-time
Ajv standalone validators cannot represent later schema.json edits. Do not hide a new validator engine
in `apps/demo`. If the selected interpreter fails the no-eval/bounds/local-ref contract, stop #79-V and
record a parent-linked decision issue. Alternatives requiring Builder approval: another independently
verified interpreter, or a materially reduced built-in-schema-only demo. Never label unchecked data
valid and never restore #75 merely by assertion.

**Supported schema profile `demo-json-2020-12-v1`:** boolean schemas or schema objects. Allow only:

- `$schema` absent or exact `https://json-schema.org/draft/2020-12/schema`, `$defs`, `$ref`;
- `type` (one of null/boolean/number/integer/string/array/object, or unique nonempty list thereof),
  `const`, nonempty `enum`;
- `properties`, unique `required`, boolean/schema `additionalProperties`;
- schema/boolean `items`, `prefixItems`, nonempty `anyOf`, `oneOf`, `allOf`;
- finite `minimum`, `maximum`, numeric exclusive bounds, positive finite `multipleOf`;
- nonnegative integer `minLength`, `maxLength`, `minItems`, `maxItems`, `minProperties`, `maxProperties`;
- bounded string `title`, `description`, JSON `default`, JSON array `examples` as **annotations only**.

Reject unknown keys and wrong keyword value shapes, including unknown `x-*`/`x-kalada`, vendor/internal
`__absolute_*` keys, `format`, regex/patternProperties, uniqueItems, conditionals/not/contains,
propertyNames/dependencies, unevaluated vocabulary, `$vocabulary`, `$id` at any depth, anchors/dynamic or
recursive keywords, and external refs. This is intentionally narrower than either library. Reject
unsupported vocabulary even in unused definitions. No silent strip/coercion/default application or
semantic override. Schema admission validates this finite profile's keyword shapes and resource policy;
it is **not a general data validator**. Semantic validation remains exclusively the selected interpreter.

Refs are `#` or `#/...` JSON Pointers, with strict `~0`/`~1` decoding and bounded percent decoding. Resolve
only own data schema locations in the same document; reject unresolved pointers, non-schema targets,
and ambiguous encodings. Never fetch. Treat applicator/ref edges as non-consuming; properties/items/
prefixItems edges consume one instance child. Reject every cycle consisting only of non-consuming
edges (`$ref:"#"` with no child progress included). Consuming recursion such as optional `next` objects
is admitted subject to limits. No recursive dereferenced object copying; keep refs in validator input.

**Concrete safety caps (not a performance SLA):** schema and each expression 64 Ki UTF-16 code units,
data 256 Ki, import/export 1 Mi; at most 16 expression docs; JSON nesting 32; schema nodes 512 and edges
2048; each union/intersection <=8 branches; each collection/object <=128 entries; total data nodes 4096;
string values <=4096 code units. Preflight JSON nesting/length before JSON.parse with a bounded JSON
string-aware delimiter scan (not a Kalada parser), then bounded iterative own-data traversal afterward.
Reject reserved object keys `__proto__`, `prototype`, `constructor` everywhere in imported JSON.

Also admit only schema/data pairs with a conservative saturated work estimate <=1,000,000: derive the
maximum number B of non-consuming schema paths reachable before the next child-consuming edge,
counting repeated applicator/ref paths (not deduplicating their costs), with iterative saturated
counting on the non-consuming DAG rather than enumerating unbounded paths. Let D be measured data depth,
N total data nodes, S schema node count. Use `N * S * max(1,B)^(D+1)`, saturating at limit+1. This can
reject otherwise valid JSON; show **workload unsupported**, not **invalid data**. It bounds expansion
without interpreting validation truth. #79-V must demonstrate this estimate covers the selected
interpreter's actual repeated traversal on admitted recursion/applicators. No regex vocabulary is
admitted. Constructor/validation are synchronous and not interruptible; cancellation cannot enforce a
wall-clock deadline. Catch failures to a static safe error, never exception message/stack.

## Binding and validation/decode/codec pipeline

Use one stable binding: `{id:"demo:data", name:"data", path:["data"]}`. `data.json` holds the whole JSON
value; evaluation receives an app-created own-data record `{data: validatedValue}`. Arbitrary JSON keys
are not turned into top-level identifiers. Completion can insert only names admitted by syntax's field
contracts; other keys remain visible in the data/shape inspector but are not accessible in source.
Virtual paths are fixed `schema.json`, `data.json`, and flat `[A-Za-z0-9_-]+.kalada` names (<=64 chars),
unique with no slash, dot-dot, URL, or filesystem interpretation. URIs are app-generated
`kalada-demo://workspace/<encoded-name>`. Never trust imported URI strings.

Pipeline on schema edits:

1. Parse/bound/profile-check schema text. Make independent passive JSON copies for Scheman and validator:
   the validator's reference preprocessing must not mutate the schema used by Scheman/canonical identity.
2. `ingestSchemaDocument(copy, {provider:jsonSchemaProvider({dialect:"draft-2020-12"}), limits})`;
   consume input for editor shape and output for semantic mapping. No allow-execution permission, Zod,
   Standard JSON converter, middleware callbacks, or schema-selected codec/import.
3. Instantiate the real validator. Wrap it in an app-owned synchronous `StandardSchemaV1` whose
   `~standard` is `{version:1, vendor:"kalada-demo-cfworker", validate}`. Admission/bounds run before any
   direct validation call. Failure returns `{issues:[{message:"Data failed schema validation"}]}`;
   success returns `{value:input}`. No transform: decode is explicitly identity. Keep detailed validator
   errors private; display bounded static code plus safe instance/schema pointer only, never `.error`.
4. Pass this wrapper in adapter `validator:{validator,mode:"sync",capabilityId:"demo-json-validator",
   capabilityVersion:"4.1.1/demo-json-2020-12-v1",configurationDigest,cacheable:true}` and the binding above.
   Provider identity is `demo.scheman-json`, version includes pinned Scheman/adapter/profile contracts,
   configurationDigest is SHA-256 of canonical schema + options/profile/binding identity (not data).
   Async Web Crypto hashing is app setup only and must be epoch-checked; no async host API is invoked.
5. No codec capability is installed: identity JSON needs no conversion. Host therefore does own lookup
   -> Standard validation/identity decode -> no codec -> final Kalada value/semantic check -> freeze/bind
   -> synchronous core evaluation. Future transforms/codecs require separate approved examples/issues.

**Whole-data semantics:** run the same wrapper over data.json before showing a valid workspace value,
even when an expression is constant with no dependencies. `prepared.evaluate({data})` runs the host's
validator again only if `data` is a dependency, as required by host semantics. Do not bypass it or attach
subschema validators per field; both runs use the identical schema snapshot, profile, and identity output.
Generation uses that exact whole-data validator too. Invalid data blocks all current evaluation panels
(the independent source diagnostics/compile inspectors still work). Prior successful data is never
silently used. Root JSON and nested field semantics remain whatever #76/syntax return, including dynamic.

## Workspace and editor lifecycle (#79-W)

Built-in workspace contains `schema.json`, `data.json`, and **`greeting.kalada`, `count.kalada`,
`enabled.kalada`**. Example root object has required `user:{name:string}`, `count:number`, `enabled:boolean`;
expressions are `data.user.name`, `data.count + 1`, and `data.enabled ? data.user.name : "off"`. They are
independent programs, not modules. JSON docs use CM JSON/plain text editing only, not Kalada LS documents.

App owns one service and one #78 session per expression URI. Open all expressions once; only active
view is attached. On tab change save EditorState (including selection/history), detach/destroy old view,
attach a new view for the selected session, and increment view epoch. Do not close/reopen on selection.
Hidden sessions retain text/revision/preparation but cannot publish into the selected view. Closing a
file disposes its session; reusing the same URI requires a higher revision. Reset disposes all sessions
and creates a new workspace/service epoch. Selection-only changes cancel tooltip intent, not evaluation.

Document revisions start at 1 and increment for every change including undo/redo, formatting, generated
data application, external replacement/import. Persist last revision as history metadata, not an
authority over an existing live service. Import into a running workspace allocates above live high-water
marks; a new service after restart may initialize at persisted version+1 (reject exhausted integers).
Text is the source of truth. Never use CM history generation or old imported versions as LS revisions.

## Live scheduling, cache reuse, and failure precedence (#79-L)

All caches and timers belong to a disposable workspace instance. Capture
`{workspaceEpoch, uri, documentVersion, schemaVersion, environmentGeneration, dataVersion,
validationGeneration, settingsVersion, requestSequence}` as applicable. View publication additionally
captures active URI/view epoch; generation captures seed + generator version + starting dataVersion so
it cannot overwrite a manual edit. Every await/dynamic import/hash/timer/init result checks its key
**after** completion and **immediately before** publishing. Drop stale errors as well as successes.

- Owner is app scheduler: schema/data debounce 150ms after edit, each expression prepare/evaluate
  debounce 150ms independently. Work executes sequentially on the main thread; “independent” means
  separate keys/timers/results, not parallel sync computation. Schema change immediately invalidates
  current readiness, advances environment generation, publishes a safe failed environment to LS,
  clears live output and refreshes sessions. Successful schema installation advances generation again.
- Data change advances data/validation generations, clears current outputs, validates after debounce,
  and evaluates only valid current data. Do **not** rebuild Scheman/environment or clear prepared plans
  for data-only changes. Schema invalidity prevents data validation from claiming a current success.
- Source change invalidates that file's parsed/compiled/prepared cache only. Store at most one current
  artifact of each kind per doc plus one reusable prior compiled artifact during a schema transition.
  Prepare via public parse -> compile -> link. Parsed cache key = source/version/parse options;
  compilation key adds semantic compile projection and compile options/contracts; prepared key adds
  environment generation/capability identities. No app-invented fingerprint from object identity.
- On schema change, discard all prepared plans. Reuse a compiled artifact only when compile projection
  and compile settings match canonically, then let public `linkExpression` enforce compatibility.
  Otherwise recompile. On data-only changes reuse prepared instance. No values in compiled/link caches.
- LS analyzes for editor diagnostics; app host pipeline owns executable artifacts and resultType.
  Duplicate parse work is acceptable initially, not permission to call LS internals or expose evaluator
  through LS. Diagnostics panel may present the authoritative phase result once rather than duplicates.
- Schema setup failure outranks data failure; then source parse/lower/compile/link; then host binding
  lookup/decode/conversion/semantic in dependency order; then core evaluation. Source issues can still
  be shown when data invalid. Cancellation/supersession is a UI state, not a language diagnostic.
- Loading/invalid/unsupported/ready states are explicit. No stale output looks current. Previous output
  may be hidden entirely (recommended), not reused without its stale key. Timing from performance.now
  labels **app-observed elapsed milliseconds**, split setup/prepare/evaluate if available; never feed
  clocks into fingerprints or call this authoritative compiler timing.

A failed schema maps to a static app diagnostic and an LS `DescribeEnvironmentResult` failure with
`HostEnvironmentDiagnostic` code `HOST_ENVIRONMENT_INVALID_PROVIDER`, phase environment, safe fixed
message, no provider exception details. Keep app JSON pointers outside host binding paths. Valid schema
with adapter unknown/dynamic warnings may install; partial/truncated structure cannot support generation
as complete. An adapter error or unsupported validator profile blocks readiness. Invalid schema leaves
last-good inspector only if explicitly marked stale; current LS has failed environment, not last-good.

## Deterministic candidate generation (#79-G)

No public Scheman generator was found in v2. Implement an **app-local candidate generator**, not validation
or type inference, over normalized editorGraph's `data` input root (derived only from SchemaDocument
input). Freeze contract **`demo-input-candidate-v1`**. Never use output semanticType or runtime values.

Canonical input encoding covers **only the subgraph reachable from the `data` INPUT root** through
input structural edges and resolved reference targets. The current adapter synthesizes definition
aliases from source node IDs: build a lookup to resolve aliases/targets, but never encode or order by
synthetic definition names, node IDs, or definition-table position. Definitions are not traversal roots;
exclude unreachable and output-only definitions/nodes, even when present in the normalized graph.

Assign canonical indices on first encounter in a root-first traversal with stable structural edge
order: object properties sorted by UTF-16 field name, then additionalProperties; array element; tuple
items by index, then rest; union variants/intersection operands in declared order; record key then value;
wrapper inner; reference target. Encode repeat/cycle edges using those canonical indices. Reference
records retain resolution status and canonical target, not the synthetic alias or source-local ID.
Include reachable node kind, scalar name, required/presence, literal/enum values, constraints, wrappers,
structural edges, availability, and explicit generation bounds. Encode unknown/unresolved evidence as
codes at canonical structural paths, not raw alias-bearing paths/messages; unrelated graph-wide or
output evidence is excluded. Exclude provenance, annotations/descriptions, clocks, and object insertion
order. Encode only copied passive JSON; reject nonfinite numbers/unsupported graph payloads. Same
canonical input shape + uint32 seed + contract version/bounds produces identical candidate byte sequence.
Validation acceptance additionally depends on the admitted canonical schema (never imply shape equality
proves validator equivalence).

PRNG is xorshift32: unsigned state initialized from decimal uint32 seed, zero replaced by `0x6d2b79f5`;
next: `x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state = x >>> 0`. No Math.random/date/locale source.
Golden PRNG seed 1 first three draws: **270369, 67634689, 2647435461**. Stable output JSON has sorted object
keys, no insignificant whitespace; number encoding uses finite JSON number rules and normalizes -0 to 0.

Generation defaults/hard caps: depth 8, 1024 visited expansion states, 32 members per collection,
8 whole-candidate attempts. Account repeated/cyclic edges before expansion. Do not restart PRNG between
attempts. Unsupported node/constraint yields visible `generation-unsupported`; exhaustion yields
`generation-exhausted`, neither is a valid result. No silent required-key or collection truncation.

Rules:

- Objects visit sorted properties; always generate required keys, omit optional keys in v1 (no draw).
  Unknown presence is unsupported. Required names with no usable shape fail. Additional unspecified
  keys are not invented. If minProperties cannot be met by required keys, fail unsupported rather than
  add guessed names. Arrays choose minItems or 0. Tuples choose explicit minItems if present; otherwise choose
  min(prefix count, maxItems if present), then emit that many prefix/rest elements. A required length
  beyond maxItems or a missing/forbidden rest fails the attempt. Never exceed the collection cap.
  Elements/rest expand only when the selected length requires a value.
- References follow input targets. Active-state recursion on a required path fails that attempt;
  an omitted optional property/empty permitted array can terminate recursion. No fake null leaf.
- Union chooses `next() % variantCount`, tries chosen branch as a candidate; retries continue PRNG.
  Keep branch order and final whole-data validation (`oneOf` overlap can reject a structurally plausible
  candidate). Intersection only generates when operands have identical canonical structural shape;
  otherwise generation unsupported (manual data can still validate). Never merge constraints as a solver.
- Literal: copy exact value. Enum: choose next modulo count. Boolean: low bit of next. Null: null.
  Integer/unconstrained-number default: `next()%21 - 10`; with finite bounds use ceil(lower)/floor(upper), adjusting strict endpoints. If only one
  bound exists, choose a 21-integer interval extending inward from that endpoint. Reject unsafe
  endpoints or an inclusive interval wider than 2^32; otherwise choose lower + next()%width (modulo
  bias is part of v1, not a statistical uniformity claim). Empty intervals fail. multipleOf is not
  solved: generate within this interval and let whole-candidate validation/retries accept or reject;
  final validator is authoritative. No widening unsatisfiable constraints.
- String: use `"a"` repeated minLength (default 0), respecting maxLength and 4096 cap; no format/regex.
  `unconstrained json` produces null. Bigint/date/undefined/symbol/opaque/unknown/never, transformation
  wrappers, unresolved/truncated nodes are unsupported. Readonly/brand wrappers may unwrap;
  nullable/optional are structural alternatives, not an invented Kalada Option.
- Final candidate passes input limits and work estimate, then the **real whole-data validator**; only
  `{valid:true}` permits “Apply generated data,” atomically replacing data.json at a fresh revision.
  Invalid candidates retry up to cap; never mutate the workspace on failure/cancel/stale success.

Golden output fixtures: seed 1 bare boolean -> `true`; seed 1 unconstrained integer -> `5`; any seed
literal `{"x":1}` -> `{"x":1}`; object with optional self-ref `next` and no required keys -> `{}` without
PRNG draws. Add exact expected bytes for required objects, tuples, union selection/retry and constraints,
plus canonical-ID/property-order invariance. The invariance fixture must consistently rename source
node IDs **and synthetic definition aliases**, update their references, and reorder the definition table;
canonical bytes and seeded candidate bytes must remain identical. Adding/reordering unreachable or
output-only definitions must likewise leave both unchanged. All accepted golden data must independently
validate.
Changing any rule or default bound requires generator-contract version change and new vectors.

## Inspector DTOs and result serialization (#79-I)

Never `JSON.stringify` a live artifact, prepared instance, capability snapshot, arbitrary error, or
provider object. Build bounded deeply frozen DTOs through explicit field visitors and own data
property reads; stringify only the resulting passive DTO. Unknown discriminants become an omission
marker, not reflective spreading. Inspector fields available today:

| Pane | Existing source / allowlist |
| --- | --- |
| CST | `ParsedExpression.syntax.document`: token kind/range, CST kind/range and documented child/token indices, field/reference names; diagnostics separately. Source/token text/literal values require explicit local reveal. |
| Canonical program | `CompiledExpression.program`: format/version/profile/expression discriminants and public canonical node fields via an exhaustive tagged visitor, not `coreCompilation`. References are fixed safe binding IDs. Literal payloads redacted by default. |
| Source map | `compiled.sourceMap`: path, role, offset range; no copied source. |
| Scheman | formatVersion, root IDs, capabilities, definitions (side/local pointer/name/node ref), node kind and structural edges/presence; no metadata/annotation values. Constraints only admitted numeric/length limits. |
| Environment | format, bindings id/name/path/semanticType/editorShapeRoot; compileProjection; provider ID/version; cacheability boolean/reason; graph topology/availability/evidence and declared limits. No metadata, raw configurationDigest or provider source paths. |
| Dependencies | `compiled.dependencies`: ordered safe binding IDs, not values. |
| Link plan | `prepared.linkPlan`: index, bindingId/name/path/semanticType; validator/codec kind/mode/ID/version only. No capabilities map, callbacks, handles for arbitrary providers, or evaluate. |
| Diagnostics | code, phase, fixed message, source URI from workspace allowlist/range, safe local pointer/binding path. Cause copied as code/range/path only; no exception/provider/validator message or stack. |
| Result type | `compiled.resultType`, syntax-owned projection; unavailable after compile failure, never inferred by app. |

Public gaps: LS `analysis` does not expose deps/link plan/resultType, but host compiled/prepared artifacts
do; use them directly. Host parse failure and LS analysis on syntax failure do not expose recovery CST.
For the CST pane, call public `parseKaladaV1Expression` on the same bounded/versioned source, retaining
its document and diagnostics; never synthesize a host ParsedExpression from it. This allows incomplete
source inspection without changing host/LS APIs or creating a second parser. No new host inspector API
is needed. A lossless CST contains user source and canonical literals contain user-authored values: **safe defaults cannot also reveal all of them**.
Provide a clearly labeled local “Reveal source/literals in artifact inspector” switch, off by default,
with bounded copies of those declared fields only. This deliberately distinguishes intentional source
inspection from sanitized diagnostic metadata. Neither reveal state nor revealed artifact is persisted
or exported. Propose the explicit issue amendment in the overview rather than claiming lossless redaction.

Dedicated data and result panes intentionally display user values, labeled “local data/result — may
contain secrets.” Encoder iteratively emits tagged DTOs for Kalada Option/Result/Instant/Duration using
public core brand guards (`isOption`, `isResult`, `isInstant`, `isDuration`) and then their declared
`type`/`variant`/`value` or `milliseconds` fields, not user JSON lookalikes. Encode bigint as `{type:"bigint",decimal:"..."}`,
undefined/nonfinite as explicit tags if encountered, repeated references/cycles as `{type:"reference",id}`, callable or
unknown objects as `{type:"unsupported"}`. Read own data properties only; never call toJSON/getters or
reflect functions. Use max depth 32, max nodes 4096, output text cap 256 Ki and explicit truncation
markers. JSON imports cannot contain ADTs/bigint/cycles; tagged display is not an executable import
format. No result/raw value belongs in diagnostic telemetry (there is no telemetry).

## Persistence, import/export, and deterministic failure UX

The PROPOSED import/export and persistence envelope has this complete exact-key contract. Every field
is required; reject missing or extra keys both at the top level and in each document record:

```ts
interface DemoWorkspaceEnvelopeV1 {
  readonly format: "kalada-demo-workspace";
  readonly version: 1;
  readonly schemaText: string;
  readonly schemaRevision: number;
  readonly dataText: string;
  readonly dataRevision: number;
  readonly documents: readonly {
    readonly name: string;
    readonly text: string;
    readonly revision: number;
  }[];
  readonly activeName: string;
  readonly seed: number;
  readonly generatorVersion: "demo-input-candidate-v1";
}
```

Validate the literal format/version/generatorVersion, exact keys/types, uint32 seed, unique safe names,
at least 3 and at most 16 expressions, activeName naming `schema.json`, `data.json`, or an expression
document, non-negative safe-integer schemaRevision/dataRevision/document revisions, and the previously
specified resource limits before mutation. No executable functions/options, URLs, URIs, capabilities,
codecs, artifacts, results, errors, timing, theme script, or saved editor history. Unknown format/version is rejected with
no state change. Known-format content with invalid schema/data may load into editors but immediately
enters the corresponding deterministic invalid/unsupported state, never a last-good execution.

Persistence is **off by default**. Explicit opt-in explains source/schema/data may contain secrets and
stay in this browser origin. Store one versioned workspace key after successful envelope validation;
quota/security/unavailable storage is a nonfatal static banner, in-memory edits continue. No automatic
reading of old saved content before opt-in; offer explicit restore. Reset clears that key and opt-in,
invalidates epoch, closes views/timers, and restores built-ins. Storage events do not silently replace a
live workspace. Persist no revealed inspector content, runtime outputs, diagnostics, or secrets outside
explicitly opted-in source/data. Opt-out deletes the stored key.

Import accepts file/text JSON only, byte/code-unit bound before parse, then own-data exact-shape checks
and safe copy. Application testing entry points accepting objects must reject accessors/exotic prototypes
without invoking getters; arbitrary hostile Proxy execution is not a claimed sandbox. Reject dangerous
keys and duplicate document names. `JSON.parse` duplicate member names follow standard last-wins JSON
semantics; the resulting envelope is fully checked. Never merge with Object.assign into application
state. Export requires explicit user action and a sensitive-content warning, downloads only the bounded
versioned envelope (no results), and revokes its object URL. Browser-selected files are not ambient FS.

Error display is deterministic by phase: envelope invalid keeps existing workspace; schema JSON invalid
or profile unsupported invalidates environment; data JSON invalid or schema-validation failure blocks
execution; source errors stay per-file. Messages use static code catalogs and safe ranges/pointers,
never interpolate data/exception text. Keyboard-operable tabs, labeled controls, status live region,
focus restoration on close/reset, text-rendered inspectors, and visible non-color-only errors required.

## Browser composition and safety

Initial shell/editor uses public package entries. Lazy-load Scheman/adapter/validator as one setup chunk
when opening the workspace; generation and advanced inspector UI may be lazy chunks. No schema-selected
import paths. Display loading/failure states; stale lazy import/setup results cannot revive reset/disposed
workspaces. No global caches. Package import graph must show core/host/LS consumers do not load optional
vendors. Avoid adding projection or unrelated optional packages just for display.

No eval/Function/dynamic schema code, Node built-ins, fetch/XHR/WebSocket in application logic, remote
schema loading, or source transmission. Serve static app chunks locally; network test allows only
same-origin built assets (no confused “zero network” claim for module loading). Production CSP must
exclude unsafe-eval; render text, not HTML. URLs in user text are not clickable links by default. Bound
input before parsing/ingestion/validation/evaluation; explicitly configure existing syntax/core limits.
Cooperative cancel checks between synchronous phases do **not** interrupt an executing validator or
core call. Main-thread initial workload is bounded as above; no performance or bundle-size promise.
#87 later measures worker tradeoffs, compute and byte budgets; do not add arbitrary gating benchmarks.

Vite `base` comes from build environment `DEMO_BASE` (default `/`); resolve assets/imports via bundler
base, no root-absolute paths. Focused browser smoke builds/previews under `/kalada-demo/` and proves
interaction there. Deployment actions/Pages credentials and full E2E matrix belong to #80, not this issue.

## Decomposition, targets, dependencies, and acceptance

All units are plan-local children of #79; Builder may file linked child issues, not untracked scope.

| Unit | Why / exact implementation targets | Depends on | Testable acceptance and exclusion |
| --- | --- | --- | --- |
| #79-V | Establish sound validation first: `apps/demo/src/schema/{admission,validator,environment}.ts`, profile fixtures; private package/Vite/tsconfig scaffold. | merged #73/#76/#78 | Pin dependency, JSON input/output + no-validator evidence, accepted/rejected schema tests, local consuming cycles/non-consuming rejection, work-bound evidence, CSP no-eval browser validation and real final host binding; no generic validator engine. |
| #79-W | Editable workspace: `src/workspace/{model,documents,lifecycle}.ts`, `src/ui/{tabs,editors,status}.ts`, `src/examples/*`, `src/main.ts`, HTML/CSS. | V | Three independent files, JSON docs, tab/undo/reopen/revision isolation, schema invalidation, accessible editing; no modules. |
| #79-L | Correct live results: `src/live/{scheduler,prepare-cache,evaluate}.ts`, `src/workspace/{persistence,transfer}.ts`. | W | Fake-timer stale races across schema/data/source/settings/import/reset; data-only prepared reuse counts; phase precedence, independent results, invalid import atomicity, disabled/quota storage; sync #73 only. |
| #79-G | Reproducible generation: `src/generation/{canonical,prng,candidate}.ts`, golden tests. | V + W | Exact vectors/canonical stability, consuming cycles, required/union/tuple/limits, invalid candidate retry, final validator check and stale-apply rejection; no inference/validation engine. |
| #79-I | Inspectability without leakage: `src/inspectors/{artifacts,diagnostics,values,view}.ts`, snapshot tests. | L | All table panes, mutation isolation, no getters/toJSON/callbacks/stacks/secret-path exposure, opt-in source reveal and labeled value panes, bigint/ADT/cycle bounds; no host API change. |
| #79-B | Usable built browser composition: `apps/demo/tests/*`, app scripts, `scripts/demo-browser-smoke.ts`, root architecture/import checks as needed. | L + G + I | Actual Chromium edit/complete/hover/format/generate/evaluate/reset/import/export, negative schemas, non-root preview, CSP/no-fetch trace, keyboard walkthrough and metafile; no deployment or new performance budget. |

Use cohesive files <=400 lines, functions <50 lines, nesting <=3. Keep schema/generation modules apart
from UI to minimize conflicts; each unit owns its tests. No hidden publishable-package changes. Genuine
package gaps need a separately justified parent-linked task and appropriate Changeset before expansion.

## Commands, risks, and handoff

Implementation adds stable app scripts `test` (unit tests), `build` (Vite), `preview` (Vite preview),
`browser:smoke` (built non-root Playwright Chromium fixture, reusing #78's development-only harness
and matching installed Chromium). Proposed root `demo:browser-smoke` delegates to app.
Run and report:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run package:smoke
bun run adapter-scheman:smoke
bun run --filter ./apps/demo test
bun run --filter ./apps/demo build
bun run --filter ./apps/demo preview
bun run demo:browser-smoke  # PROPOSED script
bun run changeset:check
git diff --check
```

Preview is a manual/local smoke server, not a command expected to exit unaided in CI; browser smoke owns
server start/stop. Capture exact browser/tool versions, packed package/import graph, bundle metafile,
allowed network requests, golden files, stale races, screenshots/accessibility walkthrough and Universal
PR Checklist. No Changeset for app/workspace/tests/docs-only changes because the app is nonpublishable.
If a package truly changes, obtain scoped approval and an impact-appropriate separate Changeset. No
runtime suite is necessary solely for this architecture writing.

Risks: validator conformance/bounded traversal must be demonstrated in V; dependency selection is not
proof. The intentionally narrow profile and whole-data `data` binding materially refine the old issue;
Builder should record them before implementation. Many detailed input fields remain dynamic semantics;
do not sell the demo as typed nested record inference. Lossless source inspectors inherently reveal user
content, so obtain approval for explicit reveal behavior. Package policy remains unresolved in #81 and
real performance unknown until #87. No other unresolved product/API choice is delegated as a TODO.

Fresh-model entry: this plan + linked actual public contracts + merged #78's real API (reconcile the
proposed #78 session API if it changed during audit). **Next owner Builder**, #79 dependency amendment
and acceptance acknowledgement; then Engineer only after #78 merge, in
`./trees/79-demo-workspace`, branch `feature/79-demo-workspace`, from then-current origin/main. Recheck
baseline drift before coding. Order V -> W -> L, with G after W and I after L, then B. Engineer updates
#79 with evidence/Checklist and `implemented` only for feature completion. Auditor sets `verified` or
`changes_requested`; Diplomat handles `in_review`/merge closure, then hands #80/#87 their actual evidence.
Any unresolved validator/security failure must be a linked follow-up/blocker, never an unvalidated fallback.

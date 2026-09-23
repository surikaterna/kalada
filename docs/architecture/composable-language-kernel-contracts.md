# Composable language kernel contracts

- Status: Draft / Proposed — behavioral design for review, not implemented or frozen API signatures.
- Date: 2026-09-23
- Authority: [PRD](../prd/composable-language-platform.md) and proposed
  [ADR-0008](../adr/0008-composable-language-platform.md); evidence plan:
  [conformance matrix](./composable-language-conformance.md).
- No assigned issue. Coordination only: Formbar #92/#93 and Kalada #21/#75/#87 as linked in the PRD.

## Reading and compatibility policy

CLK IDs are stable review contracts. “Must” below describes proposed acceptance, not a claim
about today's packages. Inputs/results describe behavior, not final names, signatures or wire
versions. Existing accepted Kalada semantics remain authoritative until a targeted compatibility
decision approves a change. Domain requirements are not permission to silently extend Kalada.
P0 reviews feasibility; P1 proves mechanics. Only real-consumer evidence at the ADR pre-freeze
gate permits consideration of API stability; passing that gate does not automatically freeze APIs.

### CLK-01 — Representations and phase results

- **Inputs:** immutable source text with document/version identity, language/context identity,
  environment generation and phase-specific options/budget. Parsed or deserialized structures
  require explicit admission evidence; current parse-limit `WeakMap` state is process-local,
  neither portable provenance nor authorization for an arbitrary CST.
- **Results:** distinguish source storage and optional CST/token views, language-owned AST,
  checked semantic facts, domain declaration IR, and canonical executable Kalada expression IR.
  Checked facts may be richer than executable IR; lowering supplies an explicit supported mapping
  or rejects the construct. Every result identifies phase, snapshot and environment and reports
  valid, invalid, partial, stale, unsupported, cancelled or budget-exhausted status.
- **Ownership:** source services retain needed text/trivia/ranges; languages own their trees;
  checkers own facts; lowerers own mapping. A universal full lossless CST is not required.
- **Rejection / exclusions:** invalid, partial, stale, unsupported, cancelled or exhausted results
  cannot authorize emission/publication. Partial recovery facts may support explicitly marked
  authoring queries only. No domain AST is implicitly a canonical expression program.

### CLK-02 — Context composition and parser handoff

- **Inputs:** immutable, versioned context profiles register eligible child languages, entry
  markers, lexical modes, delimiter ownership and recovery limits. Composition has deterministic
  precedence defined by the profile, not registration order or “try every parser.”
- **Results:** an entered child returns an owned range, exit reason, consumed boundary and
  diagnostics; the host validates its expected close boundary and forward progress. Proposed
  default: host selects an explicit entry marker, retains outer delimiters, and child lexical
  handling shields strings, comments and balanced nesting from premature exit. Alternative
  raw-text or child-owned delimiter modes require explicit profile contracts and fixtures.
- **Ownership:** host chooses the entry context, child owns interior lexical rules, host validates
  re-entry. Nested islands debit a shared request budget, never a fresh budget per island.
- **Rejection / exclusions:** reject ambiguous registrations, invalid/overlapping ranges and
  non-progress. Recovery stops at profile-approved synchronization boundaries and cannot consume
  unrelated host structure. Unterminated strings/comments, conflicting child/host delimiters and
  indistinguishable close markers need language-pair decisions; no universal delimiter algorithm
  is claimed. If safe recovery cannot establish ownership, return partial/invalid, not guessed IR.

### CLK-03 — Shared checking and canonical semantics

- **Inputs:** language-owned AST expression slots, expected types, lexical facts and explicit
  value-versus-location context, plus schema/component facts from the domain.
- **Results:** shared Kalada checks produce typed expression facts or ranged diagnostics; domain
  checks compose these with child/attribute constraints. Kalada itself must use the same services.
- **Ownership:** Kalada retains expression inference, operators and canonical evaluation rules;
  domains supply expectations, not alternative meanings of canonical operators.
- **Rejection / exclusions:** incompatible expectations and unsupported location contexts fail
  explicitly. No copied checker, per-domain expression engine or override of canonical rules;
  sharing infrastructure does not force domain nodes into executable expression IR.

### CLK-04 — Scope, identity and reference lifecycle

- **Inputs:** one snapshot's scope declarations, explicit aliases and owned source ranges.
- **Results:** stable identity within that snapshot for each symbol, scope and resolved reference;
  duplicate declarations in one scope are errors. Proposed nested shadowing is lexical and
  explicit; outer access requires a distinct declared alias, not a magic implicit fallback.
  Exact alias syntax remains open. Runtime binding slots are separate from stable domain entity IDs.
- **Ownership:** shared scope services resolve symbols; domain scope declarations define admitted
  names; the host supplies entity identity. Identity across edits needs an explicit mapping, not
  coincidental equality of names or offsets.
- **Rejection / exclusions:** unresolved/ambiguous references and illegal shadowing are diagnostics.
  Full recomputation creates clean reference indexes without old edges; optional incremental
  updates must equal that baseline after add/remove/rename and environment changes. No stale
  references survive merely because an AST object or runtime slot was reused.

### CLK-05 — Writable locations and update boundaries

- **Inputs:** a checked location requirement, symbol/path facts, stable repeated-item identity and
  declared codec directions. A writable reference is not inferred from source text or obtained by
  inverting a computed value.
- **Results:** data-only reference descriptors identify binding/entity/path and necessary revision
  or policy requirements. Reorder preserves the intended entity; removal or stale identity yields
  rejection, not fallback to the former array index. A minimal safe-write probe precedes API review.
- **Ownership:** Formbar owns authorization at use time, conflict/revision policy, updates and
  scheduling. Domain codecs declare read/write directions and failure behavior; a read codec is
  not evidence of a reversible write codec.
- **Rejection / exclusions:** computed/read-only targets, missing write conversion, removed items,
  stale revisions, denied permissions and conflicts fail under an explicit host policy. No mutation
  evaluator is added to Kalada. Field spelling, restricted `onChange` and final conflict policy
  remain open; neither arbitrary callbacks nor a selected `bind` syntax is implied.

### CLK-06 — Type vocabulary and bounded generic policy

- **Inputs:** current canonical type facts, domain schema evidence, nominal registrations and
  expected slot types. Needed checking capabilities include collection element expectations,
  structural field evidence, nominal identity and finite parameter substitution.
- **Results:** assignability distinguishes structural evidence from identity-based nominal types;
  it never equates nominal types merely because fields match. Proposed initial generic policy
  supports declared finite arity, explicit arguments, element/field lookup and bounded substitution
  in registered constructors. Required collection support must fit existing Kalada collection
  semantics. Record evidence, optional fields and alternatives may be needed in the checker;
  their representation and assignment rules await the compatibility inventory.
- **Ownership:** the shared checker owns assignability; adapters provide schema evidence, not new
  canonical semantics. Each supported checked construct needs a canonical IR mapping, a domain
  lowering, or explicit rejection if used executably.
- **Rejection / exclusions:** initial policy excludes arbitrary type-level execution, higher-kinded
  or unbounded recursive instantiation, implicit coercion and unconstrained conditional inference.
  Null/absence, records, unions and generic variance are design choices pending compatibility
  review, not silently supported new Kalada values/operators. Existing canonical behavior remains
  intact. No hardcoded fragment type, general TS type system or automatic schema-validator execution.

### CLK-07 — Trusted nominal and capability registration

- **Inputs:** trusted package registration supplies nominal ID, version, argument arity/constraints,
  permitted operations and codec IDs/directions/versions; capability metadata declares permissions,
  effects and costs. Registries are immutable generations with explicit composition rules.
- **Results:** checked references to registered identities and portable requirements; a new
  generation replaces rather than mutates facts used by an in-flight analysis.
- **Ownership:** hosts install trusted implementations; source can name admitted IDs but cannot
  register callbacks, validators, codecs or executable implementations.
- **Rejection / exclusions:** conflicting IDs/versions, wrong arity, unknown operations, untrusted
  registrations and unsupported codecs fail deterministically. Nonportable values fail portable
  artifact admission even when valid in a separately approved local-only context. No registration
  grants execution authority or implies that runtime fragment capture is supported.

### CLK-08 — Purity, capabilities and effects

- **Inputs:** checking context selects a versioned execution profile and explicit permitted
  capabilities. Proposed pure profiles admit only operations whose determinism/effect properties
  are verified under declared inputs; restricted-effect profiles enumerate allowed effects,
  authorization needs and accounting, with no ambient I/O.
- **Results:** checked effect/capability requirements accompany programs. Compilation does not
  invoke evaluators, renderers or capability callbacks to discover behavior.
- **Ownership:** domain runtimes own scheduling, effects, permissions and execution budgets;
  Arbitre owns workflow orchestration and Formbar owns reactivity/server enforcement.
- **Rejection / exclusions:** unknown effects or operations outside the profile fail checking or
  admission; revoked authorization fails linking/use. This proposal does not assert all existing
  evaluators are deterministic. Inventory and tests precede such a claim. Optional executable
  extension alternatives A/B remain separate decisions, not prerequisites for deferred expressions.

### CLK-09 — Domain lowering and consumers

- **Inputs:** current checked domain facts and checked expressions, plus target compatibility facts.
- **Results:** FSX emits existing Formbar declarations with deferred expressions and an explicit
  compatibility adapter where needed. Projection maps decoder-produced structured EDIFACT data
  into a command validated by Scheman, or JSON into an email model for a safe domain renderer.
- **Ownership:** each domain owns its IR, validation, renderer/decoder and target mapping; Kalada
  owns expression semantics. Arbitre receives explicit effect requirements and owns execution.
  Kuery gets a fit assessment of expression/context needs, not an implementation commitment.
- **Rejection / exclusions:** unsupported target declarations, unmappable checked types or missing
  runtime capabilities block lowering/admission. No eager expression evaluation, new reactive
  engine, universal domain IR or requirement that projection generate FSX. Small decoder/renderer
  fixtures can prove boundaries without delivering production integrations.

### CLK-10 — Headless semantic queries and safe rename

- **Inputs:** snapshot/environment plus position or symbol identity, requested language context
  and cancellation. Shared analysis serves browser, LSP and AI clients.
- **Results:** diagnostics, completion, hover, alias definition and reference navigation across
  supported islands, all tagged with currentness and owned ranges. Baseline rename is limited to
  statically resolved lexical aliases in one document; return atomic snapshot edits or explicit
  unsupported with no edits. Browser/LSP/AI must agree for identical supported requests.
- **Ownership:** headless services own semantic answers; adapters only translate transport/UI.
- **Rejection / exclusions:** reject collision, capture and stale rename plans. Registry keys,
  dynamic names, generated symbols and cross-document references are outside initial safe rename;
  do not partially rename them. Unsupported islands report their limit rather than pretending
  complete navigation. Broader rename and IntelliJ support require separate evidence.

### CLK-11 — Formatting, source maps and data provenance

- **Inputs:** source ownership ranges and a current snapshot; lowerers supply composed mapping
  segments with original-language ownership and explicit generated/unmapped segments.
- **Results:** formatters propose nonoverlapping, snapshot-atomic edits within owned ranges; host
  retains its delimiters. Nested maps may be many-to-one and are not assumed invertible. Diagnostic
  mapping retains the best responsible source range or explicit generated/path fallback.
- **Ownership:** language formatters own interiors, host coordinates boundary edits. Source-language
  maps are distinct from input-data provenance: EDIFACT segment/element locations follow decoded
  data, while Scheman validation paths identify command output; projection may relate all three.
- **Rejection / exclusions:** stale, overlapping or cross-owner edits fail atomically. No automatic
  reverse edit through a generated/many-to-one map; no conflation of decoder input positions with
  UTF-16 source positions, and no invented precise source location when provenance is absent.

### CLK-12 — Portable artifacts and compatibility

- **Inputs:** untrusted versioned data envelopes contain domain/expr IR, binding requirements,
  capability/nominal/codec requirements and optional source/provenance sidecars.
- **Results:** bounded admission yields validated data for separate authorized linking. Record
  compiler provenance separately from runtime compatibility; an explicit producer/consumer
  matrix maps supported language, IR, profile, plugin, registry, schema and codec requirements.
- **Ownership:** producer declares requirements; runtime validates its supported matrix before any
  capability callback, then the host resolves authorized implementations. Fresh-process and browser
  consumers must use only public runtime surfaces.
- **Rejection / exclusions:** unknown versions/requirements, malformed nodes, missing bindings,
  closures, executable payloads and live registries fail closed. No implicit “latest” mapping.
  Existing host classes/private brands/parsed-source objects are not this wire format. Source-map
  retention and envelope spellings remain open; optional metadata cannot grant execution rights.

### CLK-13 — Cache keys, currentness and authorization

- **Inputs:** compile keys cover source identity, compiler/language/IR/profile/plugin/options,
  scope/binding/type projections, schema/component/capability registry facts used by checking or
  lowering, and nominal/codec metadata. Link keys additionally cover runtime configuration,
  compatible implementations and authorization partition/generation.
- **Results:** bounded host-owned caches distinguish compile, admitted artifact and link results.
  All relevant document/environment changes invalidate currentness, including registry replacement
  with unchanged source. Runtime input values do not require recompilation of unchanged contracts.
- **Ownership:** host manages eviction, tenant isolation and revocation at use; analysis marks
  results stale when any contributing environment generation changes.
- **Rejection / exclusions:** a cache hit cannot bypass admission, expired authorization or policy
  revocation. Hashes identify content, not trust. Link-only keying is insufficient for registry or
  codec facts that influenced checking; cancellation/staleness cannot populate current caches.

### CLK-14 — Packed deployment boundaries

- **Inputs:** packed packages and precompiled fixtures exercised by fresh Node and browser
  consumers through documented public APIs, with pinned dependency/module graphs.
- **Results:** runtime imports no parser/compiler/editor; headless compiler imports no editor/LSP;
  authoring loads lazily with initial/lazy/total graphs recorded under package browser policy.
- **Ownership:** package maintainers enforce exports and dependency direction, consumer probes
  verify actual packed resolution rather than workspace aliases or internal source imports.
- **Rejection / exclusions:** forbidden transitive imports or inability to execute a precompiled
  fixture block compliance. Current host is not asserted compliant; parser-free core/projection
  paths are only partial evidence. No raw-CDN/native-ESM guarantee or invented package versions.

### CLK-15 — Shared safety, diagnostics and cancellation

- **Inputs:** request/host budgets and cancellation span parse/recovery, type/schema traversal,
  lowering, admission, linking, evaluation, output growth and cache retention.
- **Results:** bounded operations and nesting debit shared accounting across composed islands;
  diagnostics carry stable code, phase, language, snapshot and source range or domain path.
  Limit/cancellation results cannot publish IR or current edits. Sanitized diagnostics omit secrets,
  runtime values and raw untrusted payload dumps; diagnostic count/size is itself bounded.
- **Ownership:** shared infrastructure propagates accounting; each domain operation declares and
  charges its cost; host owns top-level limits and tenant isolation.
- **Rejection / exclusions:** cycles, excessive depth/work/output, unaccounted operations and
  cancelled requests stop safely, not via budget resets at child entry. Qualitative bounds apply
  from the first probe; numerical budgets and enterprise claims await Kalada #87 measurement.

## Decisions deliberately left open

Final APIs/package names, alias and writable-field spelling, conflict/update policy, type evidence
representation and canonical compatibility changes, ambiguous malformed-source handoff cases,
artifact versions/windows and budget thresholds need review. Runtime fragments/capture and A/B
operations remain optional. Neither this note nor the planned matrix resolves them by example.

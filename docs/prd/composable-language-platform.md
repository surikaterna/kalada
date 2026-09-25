# PRD: Composable language platform

- Status: Draft — user-requested product direction, not accepted or implemented platform behavior.
- Date: 2026-09-23
- Researched baseline: `b694fa6`; forward evidence updated through merge `4ce54b44cb18dc5cfcd6b3dfbcd4309b0c2d2b50`.
- Delivery proposal: [ADR-0008](../adr/0008-composable-language-platform.md).
- Proposed behavioral design: [kernel contracts CLK-01–15](../architecture/composable-language-kernel-contracts.md).
- Evidence ledger: [conformance CF01–14](../architecture/composable-language-conformance.md); bounded forward and partial diagnostic evidence only, no full CF pass.
- Review scope: [Kalada #107](https://github.com/surikaterna/kalada/issues/107),
  [PR #126](https://github.com/surikaterna/kalada/pull/126) merged.
  Coordination: [Formbar #92][f92], [#93][f93], expression-slot decision [#179][f179],
  non-repeater proof [#195][f195], repeater-write identity [#180][f180] and proof [#185][f185],
  later supported-surface completion [#187][f187] and codec/handler design [#175][f175];
  related Kalada [#21][k21], [#75][k75], and [#87][k87]. These references are not status updates.

## Context and outcome

First [core + FSX milestone #142](https://github.com/surikaterna/kalada/issues/142) targets a
read-only Formbar form hosting **full currently supported** Kalada Expressions in declared FSX
slots. Public forward parser evidence [#146](https://github.com/surikaterna/kalada/issues/146)
merged in [PR #155](https://github.com/surikaterna/kalada/pull/155) at `4ce54b44`:
independently audited 11 focused / 1040 full tests with public packed consumers, original
UTF-16 ranges, bounded recovery and non-authoritative partial results. This is bounded evidence,
not an implemented FSX form, full CF01 PASS or frozen API. Actual Kalada Expressions grammar
hosting FSX is [reverse #153](https://github.com/surikaterna/kalada/issues/153), **DEFERRED — NOT PASS**;
full [CF01/#108][k108] stays open. Reverse grammar and [EDIFACT #112](https://github.com/surikaterna/kalada/issues/112)
do not block #142 or first real read-only [Formbar #184](https://github.com/surikaterna/formbar/issues/184).

Open-source platform consumers need maintainable, configurable forms, calculations,
data transformations, rules, and domain documents. Developers, integrators, application administrators,
and AI agents should author declarative source without executing arbitrary JavaScript or
rebuilding parsing, scope analysis, diagnostics, and editor integration for every language.

The desired platform is a composed language foundation, not a mandatory expression language,
universal execution IR or evaluator. Kalada Expressions and FSX are peer language providers using
the same public kernel and shared language-service interfaces, with no privileged Expressions hooks.
Expressions owns its grammar, checker/inference, operators, IR/artifact semantics and evaluator
runtime. Languages own their syntax and mixed ASTs; FSX explicitly composes Expressions through
public APIs. A form remains a Formbar declaration containing deferred expression artifacts.
Formbar schedules calls to the Expressions runtime and owns state and rules with server enforcement;
Arbitre owns workflow runtime orchestration and effects. Kuery is a future consumer, not a
place to relocate authoring infrastructure.

### Personas and workflows

| Persona | Workflow | Observable success |
| --- | --- | --- |
| Platform developer | Register trusted components, schemas, capabilities and nominal types | One checked contract feeds headless compilation, browser and IDE diagnostics |
| Integrator | Build configurable forms with nested repeated data and expressions | Explicit aliases preserve outer access; lowering emits existing declarations, not UI components |
| Application administrator | Edit permitted attributes/rules in a browser | Current, ranged diagnostics explain invalid changes before publication; server rules remain authoritative |
| AI agent | Generate source, validate, repair, revalidate | Machine diagnostics identify code, range, context and snapshot; stale output cannot authorize publication |
| Integration developer | Decode EDIFACT and map structured data to a Scheman command | Decoder, mapping and command validation failures retain distinct provenance |
| Communication developer | Map JSON to a rich email model | A domain renderer enforces escaping, safe URLs and markup policy independently of expression safety |

## Evidence: current versus target

“Implemented” below means present in the researched source, not a guarantee of publication.
The target and open choices elsewhere in this PRD are not claims about that baseline.

| Area | Implemented evidence | Target / gap |
| --- | --- | --- |
| Source tooling | [Syntax README](../../packages/syntax/README.md): lossless tokens/CST, UTF-16 offsets, recovery, static checking/lowering, semantic queries | Shared context-aware parsing and mixed-language analysis; current grammar is Kalada-specific |
| Parse provenance | [parse.ts](../../packages/syntax/src/parse.ts) stores parse-limit provenance in a `WeakMap` keyed by parse result | No arbitrary deserialized CST admission; composition requires explicit provenance/admission contracts |
| Runtime separation | [Core manifest](../../packages/core/package.json), [projection manifest](../../packages/projection/package.json): core is dependency-free, projection depends on core | A partial parser-free path exists; do not claim all prepared execution is parser-free |
| Host artifacts | [Host manifest](../../packages/host/package.json) depends on syntax; [compiled-artifact.ts](../../packages/host/src/compiled-artifact.ts) retains parsed source, functions and private authenticity state | New portable data-only IR and runtime admission/link boundary, not JSON serialization of existing host objects |
| Schema integration | [Scheman adapter](../../packages/adapter-scheman/README.md) consumes Scheman v2, distinguishes input shape/output semantics and live capabilities | Reuse for data schemas; component contracts and writable locations need additional domain evidence; #75 is related orthogonal Standard Schema work |
| Authoring | [Language service](../../packages/language-service/README.md) handles versioned Kalada documents, UTF-16, completion/hover and currentness; [CodeMirror](../../packages/codemirror/package.json) exists | Neither a generic mixed-language service nor an LSP server currently exists; browser and VS Code/LSP must share analysis |
| Formbar target | [Definition][fb-definition], [nodes][fb-nodes], [bindings][fb-bindings], [computations][fb-computations] at clean neighboring checkout `75e69bd0d2a0eed830e2fed3e77211735a628615` | Current V1 node/prop/computation slots use Kuery `ValueExpression<StateRef>` (see [expression contract][fb-expression]); scoped bindings and stored computations exist, but V1 does **not** accept Kalada programs. Owner preference recorded in [#179][f179] and [#107][k107] is an in-place V1 Kalada slot replacement, subject to Formbar engineering signoff under #179 before real FSX lowering; no V2 is required solely for legacy/mixed-engine reads. |
| Coordination | #92 proposes declarative tooling and still mentions the earlier Kuery core; #93 explicitly requires #92 to consume Kalada syntax | Treat #93 as coordination baseline, not proof FSX exists or this proposal is approved |

## Requirements and measurable acceptance

IDs are stable product requirements. Acceptance fixtures and gates are proposed future evidence,
not tests delivered by these documents. Numeric resource budgets must follow [#87][k87]
measurement and calibration rather than invented latency or bundle-size promises.
CLK contracts distinguish the [P0 minimum experimental shape](../architecture/composable-language-kernel-contracts.md)
from later goals without freezing signatures; CF scenarios distinguish toy mechanics from real
consumer evidence. The [#123][k123] pre-freeze review requires P1–P4 evidence and an independently
audited executable non-repeater direct-write proof (#195), not full P5 delivery. It records
findings and leaves the public API open/unfrozen; it does not automatically freeze it.

### CLP-01 — Composition and source fidelity

Provide shared source documents, half-open UTF-16 ranges, tokens/trivia, bounded recovery,
context-aware parser entry/exit boundaries and source maps. Domain parsers own language AST
nodes; mixed trees preserve ownership rather than flattening every node into Kalada.
Preserve needed text/trivia/ranges through source ownership; a full lossless CST is not a universal
requirement. Checked semantic facts may exceed executable IR expressiveness only with explicit
mapping or rejection. Partial recovered analysis cannot authorize emission.
P0 permits embedding only at explicitly declared host grammar positions for listed guests in a
versioned profile: host owns outer delimiters and return validation, guest lexes the interior.
For FSX authoring, a static language default on the root Form element may select the guest
document-wide for eligible expression slots; no `@defaultLanguage` directive is required.
Explicit per-expression selection may override it only where that slot permits the guest;
neither selection can expand the slot's allowed-guest list. Forbidden inherited defaults must
diagnose rather than trigger parser guessing. Nested defaults remain optional pending real need.
Reverse embedding needs a separate declared Kalada-host position/profile; bidirectional source
composition remains a later goal, not automatic support or a runtime fragment value.

**Later full P1/CF01 acceptance (not P0 approval or a #142 prerequisite):** Kalada plus a tiny second-language fixture
compose in both declared directions, including nested delimiters, malformed islands, supported comments,
CRLF and non-BMP characters. Recovery terminates
within configured limits; diagnostics and formatting preserve correct parent-document ranges
and untouched source. The fixture need not execute or capture a fragment.
Ambiguous registrations, non-progress exits and nested budget resets are rejected; unresolved
malformed-source lexical boundaries are explicit limitations, not guessed valid programs.

### CLP-02 — Language-neutral foundation and optional Expressions

P0 specifies neutral source/snapshot, opt-in equal provider access and an initial handoff that may
carry host-owned opaque expected-type and value-versus-writable-location context. Extract shared
scope, registration/type-identity and generic infrastructure only as real consumers justify it;
shared language-service routing remains a later goal. Type rules and lowering remain language-owned;
generic infrastructure must not impose Expressions assignability or execution semantics. Expressions uses the same public
registration and service access as FSX; projection and FSX compose it rather than fork its engine.

**Acceptance:** existing Kalada conformance fixtures preserve programs, behavior and diagnostics
under the Expressions package's compatibility policy. A minimal domain-only consumer uses kernel
and tooling without installing/registering Expressions, Formbar, projection or editor packages.
Dependency tests reject kernel/shared-service imports of expression syntax, checker, IR or evaluator;
registration tests prove identical public access without privileged hooks. No duplicate engine is needed.
Collection/structural/nominal checking needs and bounded generic support are inventoried later
from pending type design choices; no new null/record/union semantics silently enter canonical Kalada.

### CLP-03 — FSX lowers to deferred Formbar declarations

FSX is declarative, JSX-like syntax, **not JavaScript or TypeScript**. Formbar owns the proposed
`@formbar/fsx` compiler and a separate authoring package; final package names are provisional.
The root Form language default is static compiler input, not a runtime Formbar prop or
source-authored provider registration; the slot profile still controls allowed guests.
Explicitly compose Expressions using its public compiler/provider interfaces, making expression
embedding straightforward without privileged integration. Compile to existing Formbar declarations
plus embedded, deferred Expressions artifacts with explicit
references. First editable slots accept only direct statically identified writable locations,
not computed values. Do not evaluate expressions at compilation, render components, or describe the
whole form as an executable Kalada AST. Formbar retains reactive state, scheduling and rules,
including server enforcement; it schedules calls to the Expressions runtime. Neither compiler nor
projection duplicates those responsibilities.

First #142/#184 form is **read-only**: fields, nested read aliases, form-wide condition and
computed output; changing input updates output without recompilation. Trusted component/scope
contracts [#183](https://github.com/surikaterna/formbar/issues/183) and #179 engineering signoff
are still required. Neutral whole-document diagnostic peer [Kalada #111](https://github.com/surikaterna/kalada/issues/111)
remains open; merged [#137 PR #139](https://github.com/surikaterna/kalada/pull/139)
is partial diagnostic evidence, not complete CF02/CF13. Neither reverse #153 nor EDIFACT #112
is a first-form prerequisite. Current Formbar V1 validators compile Kuery slots, extract sorted `StateRef` dependencies for
computation reference/cycle checks, and report definition **paths**, not FSX source ranges.
The proposed in-place V1 replacement with Kalada remains gated on Formbar engineering signoff
in [#179][f179]: define Kalada dependency extraction and cycle equivalence, scoped binding,
runtime evaluation and path-to-source diagnostic mapping before lowering a real form. Existing
Kuery-encoded data must be explicitly rejected or migrated, never silently reinterpreted as Kalada;
do not assume there are no external consumers of published `@formbar/declarative`. An incompatible
publishable Formbar change needs a major Changeset, not automatically a Kalada package Changeset.
Future versioned portable artifacts are a separate target, not a reason to require V2 slots now.
General Kalada programs are not presumed translatable to Kuery AST; parser-only [#108][k108]
does not resolve this gate.
[#180][f180] gates repeater-scoped writes separately; first direct non-repeater edits and
repeated-item **reads** need not wait for stable write identity. Repeater-scoped writes remain
**DISABLED** until #180 and independent Formbar [#185][f185] proof; #180 does not block [#123][k123]
when repeaters are excluded from the supported write surface.

**Acceptance:** a field/output/conditional form lowers to declaration fixtures accepted by
Formbar; changing runtime input changes the result without recompiling source. Compile-time
spies prove no evaluator, renderer or capability callback is invoked. Equivalent server/client
rule fixtures agree, with server authorization enforced independently of the browser.

### CLP-04 — Schemas and trusted registries

Scheman v2 describes data schemas, not UI behavior. A versioned component registry declares
attributes, expected expression types, child constraints, writable-reference requirements and
introduced scopes. A separate trusted capability registry identifies allowed domain operations.
Source names IDs; source cannot install code, validators or components.

**Acceptance:** fixtures reject unknown components/capabilities, invalid children, incompatible
attribute types and read-only expressions in writable slots, with source ranges. Tests preserve
the distinction between schema structure, validation, semantic types and explicit conversions.

### CLP-05 — Lexical scopes and writable references

Use explicit lexical aliases with specified shadowing and outer-scope access. A computed value
is not a writable location: Kalada checks direct static location eligibility for the first edit,
while Formbar resolves identity, authorization, revisions and server policy at update time.
Nested repeated items need stable identity independent of index so
reordering cannot retarget a pending update. Formbar owns update authorization and scheduling.
The write/reference contract must be explored in P0/P1, before read-only FSX hardens an
incompatible design; complete writable behavior follows in P5.

**Acceptance Stage A ([#195][f195], before [#123][k123]):** an independently audited executable Formbar
server-authorized direct non-repeater write proves a static Kalada location is only eligible,
never authorized. At update time reject computed, read-only, denied, stale, removed, conflicting
and unsupported targets without mutation; reject unsupported write-codec direction if applicable.
No reversible codec or restricted handler is required for the first direct edit. Full P5 UI/domain
completion is not required. A reviewed update policy precedes enabling writes; surface spelling
remains open and `bind` is not selected.

**Acceptance Stage B ([#180][f180]/[#185][f185], required for [#187][f187]):** stable item keys and atomic
Formbar resolve/authorize/update survive reorder and reject replacement/removal, missing or
duplicate keys and stale/conflicting writes without mutation or index fallback. Independent
audited executable #185 proof after #180 is mandatory for #187's current P5 repeater-write scope;
#123 needs only Stage A with repeater writes disabled. P6 requires Stage B if repeater writes are
selected for release and cannot claim unsupported writes as supported. Dropping repeaters from
#187 requires a separate issue amendment, not a docs-only change. Nested read aliases/shadowing
may be tested without enabling writes. Reversible codecs and restricted handlers remain Formbar
[#175][f175] needs-design, not a #123 prerequisite for direct writes.

Current repeated runtime/renderer identity is index-derived; this cannot safely address a pending
repeater-scoped write after reorder/replacement. [#180][f180] requires stable item identity and
atomic resolve/authorize/update before those writes, independently verified in #185 and distinct
from [#175][f175] codec/handler design.

### CLP-06 — Domain-owned nominal types

If consumer evidence warrants it, trusted domain packages may later register nominal types with
explicit identity, version, checking and permitted operations/encoding. Neither kernel nor
Expressions has a built-in `FormFragment` type.
Source composition does not imply executable fragment capture, closures or runtime fragment values.

**Acceptance:** a test domain supplies a nominal type without a Formbar import in kernel or Expressions; unknown
or incompatible identities fail deterministically. Any nonportable type is rejected at a portable
artifact boundary. Runtime fragment values/capture remain an explicit optional decision, not
an initial FSX gate.

### CLP-07 — Projection and domain output workflows

Projection remains a thin consumer of the Expressions package's public contracts with its own bounded mapping
semantics, not a second language engine or Formbar reactive runtime. A future EDIFACT decoder
produces structured data, mapping produces a command, and Scheman validates that command.
JSON-to-rich-email mapping produces a domain model consumed by a safe domain renderer.
Neither workflow is required to generate FSX.

**Acceptance:** fixtures retain decoder/input-location, mapping-source and command-validation
provenance; email fixtures reject or escape hostile markup/URLs at the renderer boundary.
Mapping tests expose output-growth limits and do not invoke Formbar scheduling.

### CLP-08 — Separate deployment surfaces

Separate runtime consumers (no parser/compiler/editor), headless compilation (no editor/LSP),
and lazily loaded authoring tooling. Expressions owns runtime admission, linking and bounded
interpretation of its portable IR, distinct from source compilation; domain runtimes own their
artifacts. The kernel supplies no universal execution IR or evaluator. Core/projection's current parser-free path
does not make the current syntax-dependent host a compliant runtime-only package.

**Acceptance:** packed consumer graphs and browser metafiles prove forbidden imports absent
for each surface and distinguish initial/lazy/total chunks. Runtime consumes a precompiled
expression fixture standalone without compiler/parser/authoring or unrelated language providers.
Genuinely shared low-level helpers are allowed, not kernel-to-language coupling or mandatory provider
registration for execution. Browser support follows package policy, not a presumed
raw-CDN/native-ESM guarantee.

### CLP-09 — Portable artifacts

Define data-only, versioned artifact envelopes for domain declarations and embedded programs, explicit
binding/capability requirements and source-map/provenance references. Exclude JS closures,
private brands, live registries and runtime values. Admission validates untrusted artifacts;
linking resolves declared capabilities through tenant-authorized host registries. Expressions owns
expression IR/artifact semantics and compatibility; common envelope infrastructure does not define
a mandatory kernel execution format.

**Acceptance:** an artifact survives encode/decode and execution in a fresh process and browser
without source parsing/compilation. Malformed nodes, missing bindings, unsupported versions and
executable payloads are rejected before execution. Existing host compiled objects are explicitly
not accepted as this wire contract.

### CLP-10 — Cache identity and compatibility

Cache identity includes source/artifact identity, compiler and language versions, IR/profile,
options, binding/type projections, schema/component/capability versions and configuration,
nominal-type/codec identities, and authorization partition. Separate compile, link and runtime
values; caches are bounded and host-owned. Hashes establish identity/integrity, never trust.

**Acceptance:** changing each semantic input invalidates the appropriate cache; unchanged
inputs reproduce identity. Tenant crossover, unknown compatibility and stale capability policy
fail closed. A documented producer/consumer version matrix has positive and negative fixtures;
cache hits never bypass admission or current authorization.

### CLP-11 — Browser, LSP and AI authoring

Browser editing and VS Code through LSP are first-class consumers of the same headless mixed
analysis: diagnostics, completion, hover, formatting, cancellation and document/environment
currentness, plus alias definitions/references across supported islands. Initial safe rename is
limited to statically resolved lexical aliases in one document, rejects capture/collision and
returns atomic snapshot edits. Registry, dynamic, generated and cross-document names return
explicit unsupported with no edits; unsupported islands disclose navigation limits.
Machine diagnostics expose stable codes, UTF-16 ranges, phase/language context and
snapshot identity, without leaking values or secrets. AI validate–repair loops use this same
service, not a parallel checker. Shared services route to registered language providers; Expressions
has no built-in or privileged analysis path, and domain-only tooling needs no Expressions installation.
IntelliJ requires an actual compatibility spike; LSP alone is
not a compatibility guarantee.

**Acceptance:** browser and VS Code fixtures agree on diagnostics and edits for identical mixed
source; stale/cancelled analyses cannot publish as current. An automated repair loop rejects a
stale fix and revalidates its replacement. Record IntelliJ transport/plugin/version results and
unsupported behavior before any support claim.
Definition/reference and safe-rename fixtures agree across browser/LSP/AI; unsupported renames
produce zero edits. Formatting preserves owner boundaries and does not invert generated maps.

### CLP-12 — Security, admission and measured budgets

Treat source, schemas and artifacts as untrusted tenant inputs. Bound parsing/recovery, AST/IR
admission, graph traversal, diagnostics, linking, evaluation, projection growth and caches.
Capabilities are allowlisted, versioned and authorized; there is no ambient I/O or arbitrary JS.
Domain renderers and server rules retain their own security boundaries.
Pure/restricted-effect profiles declare permitted capabilities; no blanket determinism claim is
made for existing evaluators without an inventory and evidence. Compilation invokes no capabilities.

**Acceptance:** hostile-input and cross-tenant fixtures terminate with stable bounded diagnostics,
cannot gain capabilities or poison another tenant's cache, and do not disclose secret context.
P6 requires reproducible packed-size/compute evidence and reviewed thresholds derived through
#87's measurement gate; unstable timing remains report-only rather than becoming a fictional SLO.

## Non-goals

- Implementing packages, syntax, a compiler, LSP, runtime, caches or registries in this docs change.
- Arbitrary JS/TS, React component execution, ambient module loading or a new effect scheduler.
- Replacing Formbar declarations, Scheman validation, Arbitre orchestration or existing Kalada ADRs.
- Making modules/imports (#21), a new Standard adapter (#75), executable fragments or A/B extension
  operations prerequisites for ordinary FSX declarations containing deferred Kalada programs.
- Promising direct-browser/CDN loading, IntelliJ support, fixed resource budgets or a release date.

## Open decisions and approval gates

P0 seeks Kalada architecture and Formbar state/rules/FSX review of the minimum shape, not
cross-repo approval by publication. Reviewer decisions/objections remain pending. It must
explore aliases, outer access, stable item keys and direct writable locations early;
Formbar #175 owns the later reversible codec/restricted update-handler choice. Neither
arbitrary event handlers nor `bind` spelling is approved. CF01's executable two-direction
probe, CF02 shared-infra evidence and CF05 Stage A #195 proof are separate later gates.
[#123][k123] records/reviews those results, not an API freeze; repeater writes remain disabled pending
#180/#185; current #187 requires Stage B, while P6 requires it if repeater writes are released.

Runtime fragment values/capture and nominal serialization remain optional. If an executable
domain extension is needed, choose between A (lowered extension operations) and B (common
operations/capabilities) using the ADR tradeoffs within the relevant language/domain runtime,
never as universal kernel execution. Neither is needed for initial FSX lowering.
Portable IR admission versus current host compilation, version windows, and tenant cache
partitioning need conformance evidence before release. Future work is captured in the ADR's
proposed phases, not newly created issues or invented assignments.
The kernel contracts and matrix join this PRD and ADR as four documentation-only proposal files;
their validation is not evidence that any planned conformance scenario has run.

[f92]: https://github.com/surikaterna/formbar/issues/92
[f93]: https://github.com/surikaterna/formbar/issues/93
[f175]: https://github.com/surikaterna/formbar/issues/175
[f179]: https://github.com/surikaterna/formbar/issues/179
[f180]: https://github.com/surikaterna/formbar/issues/180
[f185]: https://github.com/surikaterna/formbar/issues/185
[f187]: https://github.com/surikaterna/formbar/issues/187
[f195]: https://github.com/surikaterna/formbar/issues/195
[k107]: https://github.com/surikaterna/kalada/issues/107
[k108]: https://github.com/surikaterna/kalada/issues/108
[k123]: https://github.com/surikaterna/kalada/issues/123
[k21]: https://github.com/surikaterna/kalada/issues/21
[k75]: https://github.com/surikaterna/kalada/issues/75
[k87]: https://github.com/surikaterna/kalada/issues/87
[fb-definition]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/definition.ts
[fb-nodes]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/nodes.ts
[fb-bindings]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/bindings.ts
[fb-computations]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/computations.ts
[fb-expression]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/expressions/src/contracts.ts

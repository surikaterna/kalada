# PRD: Composable language platform

- Status: Draft — user-requested product direction, not accepted or implemented platform behavior.
- Date: 2026-09-23
- Evidence baseline: Kalada `b694fa654938392d7f01367f7ac3d31278ce2d51` (`b694fa6`).
- Delivery proposal: [ADR-0008](../adr/0008-composable-language-platform.md).
- Proposed behavioral design: [kernel contracts CLK-01–15](../architecture/composable-language-kernel-contracts.md).
- Evidence plan: [conformance CF01–14](../architecture/composable-language-conformance.md), all planned, not run.
- Assignment: no assigned Kalada issue. Coordination: [Formbar #92][f92] and [#93][f93];
  related Kalada [#21][k21], [#75][k75], and [#87][k87]. These references are not status updates.

## Context and outcome

Open-source platform consumers need maintainable, configurable forms, calculations,
data transformations, rules, and domain documents. Developers, integrators, application administrators,
and AI agents should author declarative source without executing arbitrary JavaScript or
rebuilding parsing, scope analysis, diagnostics, and editor integration for every language.

The desired platform is a composed language foundation, not a universal form evaluator.
Kalada expressions themselves must use the reusable foundation. Domain languages own their
syntax and mixed ASTs; a form remains a Formbar declaration containing deferred Kalada
programs. Formbar owns state, reactive scheduling, and rules with shared server enforcement;
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
| Formbar target | [Definition][fb-definition], [nodes][fb-nodes], [bindings][fb-bindings], [computations][fb-computations] at clean neighboring checkout `75e69bd0d2a0eed830e2fed3e77211735a628615` | Existing version-1 declarations have expression slots, scoped bindings and computations; FSX must lower to these contracts with an explicit expression compatibility adapter where needed |
| Coordination | #92 proposes declarative tooling and still mentions the earlier Kuery core; #93 explicitly requires #92 to consume Kalada syntax | Treat #93 as coordination baseline, not proof FSX exists or this proposal is approved |

## Requirements and measurable acceptance

IDs are stable product requirements. Acceptance fixtures and gates are proposed future evidence,
not tests delivered by these documents. Numeric resource budgets must follow [#87][k87]
measurement and calibration rather than invented latency or bundle-size promises.
CLK contracts specify minimum behavior without freezing signatures; CF scenarios distinguish toy
mechanics from real consumer evidence. A pre-freeze review requires P1–P4 evidence and a safe
writable-reference proof, not full P5 delivery, and permits review rather than automatic API freeze.

### CLP-01 — Composition and source fidelity

Provide shared source documents, half-open UTF-16 ranges, tokens/trivia, bounded recovery,
context-aware parser entry/exit boundaries and source maps. Domain parsers own language AST
nodes; mixed trees preserve ownership rather than flattening every node into Kalada.
Preserve needed text/trivia/ranges through source ownership; a full lossless CST is not a universal
requirement. Checked semantic facts may exceed executable IR expressiveness only with explicit
mapping or rejection. Partial recovered analysis cannot authorize emission.
Support bidirectional source composition by design: domain syntax can contain Kalada expressions,
and a registered domain region can appear inside a Kalada-led source context. This does not
require that the region become a first-class runtime value.

**Acceptance:** Kalada plus a tiny second-language fixture compose in both directions, including
nested delimiters, malformed islands, comments, CRLF and non-BMP characters. Recovery terminates
within configured limits; diagnostics and formatting preserve correct parent-document ranges
and untouched source. The fixture need not execute or capture a fragment.
Ambiguous registrations, non-progress exits and nested budget resets are rejected; unresolved
malformed-source lexical boundaries are explicit limitations, not guessed valid programs.

### CLP-02 — Reusable expression and semantic foundation

Extract reusable scope, type/checking and lowering infrastructure alongside parsing. Kalada's
own expression implementation consumes it; projection and FSX must not fork Kalada inference
or evaluation. Language-owned rules and domain ASTs remain explicit.

**Acceptance:** existing Kalada conformance fixtures preserve programs, behavior and diagnostics
under the compatibility policy; the second consumer reuses the foundation without importing
Formbar, projection or editor packages. Dependency evidence shows no duplicate expression engine.
Collection/structural/nominal checking needs and bounded generic support are inventoried separately
from pending type design choices; no new null/record/union semantics silently enter canonical Kalada.

### CLP-03 — FSX lowers to deferred Formbar declarations

FSX is declarative, JSX-like syntax, **not JavaScript or TypeScript**. Formbar owns the proposed
`@formbar/fsx` compiler and a separate authoring package; final package names are provisional.
Compile to existing Formbar declarations plus embedded, deferred Kalada programs with explicit
references. Do not evaluate expressions at compilation, render components, or describe the
whole form as an executable Kalada AST. Formbar retains reactive state, scheduling and rules,
including server enforcement; neither compiler nor projection duplicates those responsibilities.

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
is not a writable location. Nested repeated items need stable identity independent of index so
reordering cannot retarget a pending update. Formbar owns update authorization and scheduling.
The write/reference contract must be explored in P0/P1, before read-only FSX hardens an
incompatible design; complete writable behavior follows in P5.

**Acceptance:** nested-repeater fixtures resolve distinct outer/inner aliases, expose deliberate
shadowing behavior, reject computed-value writes and stale/removed item targets, and preserve
item targeting across reorder. A reviewed update policy precedes enabling writes. Surface
spelling remains open; `bind` is not the chosen syntax.
Before stability review, a narrow executable proof must reject stale permissions, conflicts and
unsupported write-codec directions; full P5 write UI/domain completeness is not required for it.

### CLP-06 — Domain-owned nominal types

Trusted domain packages may register nominal types with explicit identity, version, checking
and permitted operations/encoding. Core must never contain a built-in `FormFragment` type.
Source composition does not imply executable fragment capture, closures or runtime fragment values.

**Acceptance:** a test domain supplies a nominal type without a Formbar import in core; unknown
or incompatible identities fail deterministically. Any nonportable type is rejected at a portable
artifact boundary. Runtime fragment values/capture remain an explicit optional decision, not
an initial FSX gate.

### CLP-07 — Projection and domain output workflows

Projection remains a thin consumer of shared expression contracts with its own bounded mapping
semantics, not a second language engine or Formbar reactive runtime. A future EDIFACT decoder
produces structured data, mapping produces a command, and Scheman validates that command.
JSON-to-rich-email mapping produces a domain model consumed by a safe domain renderer.
Neither workflow is required to generate FSX.

**Acceptance:** fixtures retain decoder/input-location, mapping-source and command-validation
provenance; email fixtures reject or escape hostile markup/URLs at the renderer boundary.
Mapping tests expose output-growth limits and do not invoke Formbar scheduling.

### CLP-08 — Separate deployment surfaces

Separate runtime consumers (no parser/compiler/editor), headless compilation (no editor/LSP),
and lazily loaded authoring tooling. Runtime admission, linking and bounded interpretation of
portable IR are distinct from source compilation. Core/projection's current parser-free path
does not make the current syntax-dependent host a compliant runtime-only package.

**Acceptance:** packed consumer graphs and browser metafiles prove forbidden imports absent
for each surface and distinguish initial/lazy/total chunks. Runtime consumes a precompiled
fixture without loading source tooling. Browser support follows package policy, not a presumed
raw-CDN/native-ESM guarantee.

### CLP-09 — Portable artifacts

Define data-only, versioned IR envelopes for domain declarations and embedded programs, explicit
binding/capability requirements and source-map/provenance references. Exclude JS closures,
private brands, live registries and runtime values. Admission validates untrusted artifacts;
linking resolves declared capabilities through tenant-authorized host registries.

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
service, not a parallel checker. IntelliJ requires an actual compatibility spike; LSP alone is
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

P0 must settle parser context/admission boundaries, mixed-node ownership, package naming and
compatibility strategy. It must explore aliases, outer access, stable item keys and writable
locations early, including whether widgets require explicit bidirectional codecs or a restricted
declarative `onChange` model. Neither arbitrary event handlers nor `bind` spelling is approved.

Runtime fragment values/capture and nominal serialization remain optional. If an executable
domain extension is needed, choose between A (lowered extension operations) and B (common
operations/capabilities) using the ADR tradeoffs; neither is needed for initial FSX lowering.
Portable IR admission versus current host compilation, version windows, and tenant cache
partitioning need conformance evidence before release. Future work is captured in the ADR's
proposed phases, not newly created issues or invented assignments.
The kernel contracts and matrix join this PRD and ADR as four documentation-only proposal files;
their validation is not evidence that any planned conformance scenario has run.

[f92]: https://github.com/surikaterna/formbar/issues/92
[f93]: https://github.com/surikaterna/formbar/issues/93
[k21]: https://github.com/surikaterna/kalada/issues/21
[k75]: https://github.com/surikaterna/kalada/issues/75
[k87]: https://github.com/surikaterna/kalada/issues/87
[fb-definition]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/definition.ts
[fb-nodes]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/nodes.ts
[fb-bindings]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/bindings.ts
[fb-computations]: https://github.com/surikaterna/formbar/blob/75e69bd0d2a0eed830e2fed3e77211735a628615/packages/declarative/src/computations.ts

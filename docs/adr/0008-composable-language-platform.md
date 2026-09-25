# ADR-0008: Composable language foundation and phased domain adoption

- Status: Proposed — draft for review, not accepted; no runtime change is authorized by this file.
- Date: 2026-09-23
- Product authority for this proposal: [Composable language platform PRD](../prd/composable-language-platform.md).
- Minimum behavioral design: [kernel CLK-01–15](../architecture/composable-language-kernel-contracts.md).
- Evidence ledger: [conformance CF01–14](../architecture/composable-language-conformance.md); bounded forward and partial diagnostic evidence, no full CF pass.
- Researched baseline: `b694fa654938392d7f01367f7ac3d31278ce2d51`.
- Review scope: [Kalada #107](https://github.com/surikaterna/kalada/issues/107),
  [PR #126](https://github.com/surikaterna/kalada/pull/126) merged; no cross-repo approval implied.
- Coordination: [Formbar #92](https://github.com/surikaterna/formbar/issues/92) and
  [#93](https://github.com/surikaterna/formbar/issues/93); related Kalada
  [#21](https://github.com/surikaterna/kalada/issues/21),
  [#75](https://github.com/surikaterna/kalada/issues/75), and
  [#87](https://github.com/surikaterna/kalada/issues/87).
- Numbering: ADR-0007 remains in open [PR #82](https://github.com/surikaterna/kalada/pull/82); 0008 avoids its allocation.

## Context and current constraints

First [#142](https://github.com/surikaterna/kalada/issues/142) milestone: read-only Formbar FSX
hosts full currently supported Kalada Expressions. Public forward [#146 / PR #155](https://github.com/surikaterna/kalada/pull/155)
merged at `4ce54b44` after independent audit (11 focused / 1040 full tests, public packed
consumers). This is bounded parser-profile evidence, not real FSX or full CF01. Actual
Expressions-hosted FSX grammar is [#153](https://github.com/surikaterna/kalada/issues/153),
DEFERRED — NOT PASS; [#108](https://github.com/surikaterna/kalada/issues/108) stays open.
Merged [#137 / PR #139](https://github.com/surikaterna/kalada/pull/139) is partial whole-document
diagnostic proof, not CF02/CF13 completion; [#111](https://github.com/surikaterna/kalada/issues/111)
remains open. Neither proof freezes APIs or grants cross-repo Formbar approval.

The PRD records platform-consumer authoring workflows and evidence distinguishing implementation
from targets. Current syntax provides a Kalada-specific lossless CST, recovery and lowering;
its parse results carry process-local `WeakMap` limit provenance. Current host compilation
retains that source structure, callable core compilation and private authenticity state.
It is not a portable cache format. Core and projection permit a partial parser-free path,
but host depends on syntax. Existing headless language service and CodeMirror are useful
foundations, not a generic composed-language service or an implemented LSP transport.

Current Formbar V1 slots are Kuery `ValueExpression<StateRef>`, not Kalada programs (see PRD's
pinned evidence). Validation compiles Kuery expressions, checks sorted `StateRef` dependencies
and computation cycles, and reports definition paths rather than FSX source ranges. Owner
preference in [Formbar #179](https://github.com/surikaterna/formbar/issues/179) and Kalada #107
is in-place V1 Kalada slot replacement, subject to Formbar engineering signoff under #179, not
V2 solely for legacy/mixed-engine reads. Old Kuery data must be explicitly rejected or migrated,
not silently reinterpreted; published `@formbar/declarative` may have external consumers.
Formbar #92's older Kuery wording and #93's Kalada coordination do not approve this decision.

## Proposed decision

Compose small language-neutral primitives, preserving language-owned mixed ASTs and lowering.
Kalada Expressions and FSX are peer providers with identical public registration and access to
kernel/shared language services, without privileged hooks. Expressions owns its grammar,
checker/inference, operators, IR/artifact semantics and evaluator runtime. Its canonical semantics
and compatibility stay in the Expressions package, not the kernel; a form is not an expression AST.

P0 records only the [minimum experimental shape](../architecture/composable-language-kernel-contracts.md):
neutral immutable source/snapshot with UTF-16 ownership, versioned declared embedding positions,
equal opt-in provider access and direct-location eligibility distinct from Formbar update authority.
Later scope/reference, type-identity, generic infrastructure, source maps and shared service routing
depend on consumer evidence. Type rules and lowering remain language-owned;
the kernel mandates no expression language, universal execution IR or evaluator. Avoid
designing an exhaustive plugin API before a second small consumer proves the boundary.
CLK-01–15 describe proposed behavior, not frozen signatures. A toy consumer proves mechanics,
not sufficient API stability: real FSX and projection evidence must inform the pre-freeze review.
Source storage/optional CST, language ASTs, checked semantic facts, domain IR and canonical
Expressions-owned IR remain distinct. Needed source/trivia/ranges do not require a universal full
lossless CST. Richer checking evidence must map explicitly to executable IR or be rejected;
it cannot silently add null, record, union or generic semantics to canonical Kalada.

### Ownership and dependency direction

Arrows below mean “depends on”; names in brackets are logical boundaries, not approved packages.
The runtime path and compile path deliberately have different dependencies.

```text
HEADLESS COMPILATION / ANALYSIS
[Expressions provider] ----> [public kernel + shared language services] <---- [FSX provider]
[minimal domain provider] -> [public kernel + shared language services]
[FSX provider] ------------> [Expressions public composition APIs] (explicit opt-in)
      |-------------------> [Formbar declaration/component + Scheman contracts]
[projection frontend] -----> [Expressions public composition APIs]
[shared analysis routing] -> [registered provider interfaces] (no built-in language)

AUTHORING (lazy, optional)
[Formbar authoring package] ------> [mixed headless analysis]
[browser adapter] ----------------> [mixed headless analysis]
[LSP server / VS Code adapter] ---> [mixed headless analysis]

RUNTIME (no source compiler, parser or editor)
[Formbar runtime / server rules] -> [Formbar declarations + Expressions runtime]
[projection runtime] -------------------------------------> [Expressions runtime]
[Expressions runtime] -----------> [Expressions artifacts + authorized capabilities]
[other domain runtime] ----------> [its own artifacts + authorized capabilities]
[Arbitre orchestration] ---------> [selected runtime / explicit host effects]
[runtimes, kernel] --------------> [optional genuinely shared low-level helpers]
```

- Kernel/shared services import no Expressions syntax, checker, IR or evaluator. Package names
  remain open; current `core` is not synonymous with the proposed kernel. A minimal domain language
  must ultimately use kernel/tooling without installing or registering Expressions. Later shared type
  infrastructure must not force Expressions rules. Runtime helpers must not create kernel-to-language coupling.
- Formbar owns proposed `@formbar/fsx` and a separate authoring package (names provisional),
  component contracts, lexical domain scopes, state, reactive scheduling and shared server rules.
- Scheman v2 owns data schema evidence; validators, shape, semantic types and codecs stay separate.
- Trusted domain packages register nominal types and capabilities. No kernel/Expressions `FormFragment`.
- Projection owns bounded mappings as a thin expression consumer, not Formbar reactivity.
- Arbitre owns runtime workflow orchestration/effects; Expressions owns bounded expression evaluation.
  Neither the parser nor a template acquires scheduling authority. Kuery remains a future consumer.

### Compilation is not rendering or evaluation

```text
FSX source + schema/component/capability facts
  -> owned source views/language ASTs + lexical checking + expected expression types
  -> Formbar declaration IR + embedded deferred Kalada programs + source maps
  -> artifact admission + authorized linking
  -> Formbar state/rules/reactivity -> renderer or server enforcement

EDIFACT -> domain decoder -> structured data -> projection -> Scheman command validation
JSON --------------------------------------> projection -> email model -> safe domain renderer
```

FSX is JSX-like declarative syntax, not JS/TS. First real read-only
[Formbar #184](https://github.com/surikaterna/formbar/issues/184) lowering awaits
[#179](https://github.com/surikaterna/formbar/issues/179) engineering signoff and trusted
component/scope [#183](https://github.com/surikaterna/formbar/issues/183) approval.
It explicitly composes Expressions through public
APIs; proposed slots lower to deferred expression artifacts, not eager values. Formbar schedules
runtime calls. #179 gates real FSX lowering: approve V1 replacement, Kalada dependency extraction,
cycle checks, scoped bindings, source ranges and runtime evaluation; reject or migrate old Kuery
data explicitly. Parser-only [Kalada #108](https://github.com/surikaterna/kalada/issues/108)
does not resolve this Formbar gate. Reverse #153 and EDIFACT #112 are not #142/#184
prerequisites. No renderer or capability callback runs during checking/compilation.
Every phase carries document/environment identity and explicit validity/currentness; partial
recovery supports limited tooling, never emission. Context profiles define lexical/delimiter
ownership, declared host positions/guests, deterministic handoff and shared budgets;
unresolved malformed-source cases fail rather than assuming a universal delimiter algorithm (CLK-01/02).

An expression value and a writable location are different contracts. The first FSX edit accepts
only a direct statically identified writable location: Kalada checks eligibility, while Formbar
resolves stable identity, permissions, revisions, conflicts and server policy at use time.
Component metadata says which is required. Explicit lexical aliases need nested outer access and
deliberate shadowing rules. Current repeated instances and row keys derive identity from indexes:
first direct non-repeater writes and repeated-item reads are separate from repeater-scoped writes.
Those writes remain **DISABLED** until [Formbar #180](https://github.com/surikaterna/formbar/issues/180)
delivers stable keys/atomic resolve-authorize-update and independent executable
[#185](https://github.com/surikaterna/formbar/issues/185) proves reorder/replacement/removal
cannot retarget. #180 does not block [Kalada #123](https://github.com/surikaterna/kalada/issues/123)
when repeater writes are excluded.
Codec directionality, restricted declarative `onChange` and surface naming remain open under
[Formbar #175](https://github.com/surikaterna/formbar/issues/175) needs-design; `bind` is not selected.
Full writes wait for a Formbar update-policy gate, not for a new Kalada mutation evaluator.

Bidirectional **source composition** is a later goal, not automatic P0 support: host grammar
positions and permitted guests must be explicit in a versioned profile; host owns delimiters and
validates return, guest lexes interior. Reverse embedding needs a distinct declared position and
profile. An embedded language can return owned ranges and context. Actual executable
fragment values, capture and lifetime semantics are optional, unresolved domain features.
A parser can compose a domain region without executing it or making it an Expressions runtime value.

### Executable extension alternatives A and B

These are contingent alternatives only for executable domain operations; neither gates ordinary
FSX with deferred Expressions. A/B decisions belong to a specific runtime, not the kernel.

| | A: executable/lowered extension operations | B: common operations and capabilities |
| --- | --- | --- |
| Representation | Domain-owned source nodes lower to explicitly versioned extension op IDs and operands | Domain syntax lowers to a bounded common operation vocabulary plus declared capability IDs |
| Execution authority | Trusted registered extension handler defines checking, execution and resource accounting | Common interpreter handles control/data flow; explicitly linked trusted capabilities handle domain operations |
| Advantages | Preserves rich domain semantics and precise diagnostics; avoids forcing everything into a generic call | Smaller interpreter surface; reusable linking, tooling and admission across domains |
| Costs | Every opcode adds runtime/version/admission/portability burden; unknown ops must fail closed | Can obscure semantics behind capabilities, lose static precision, or grow into an over-general effect system |
| Required evidence | Cross-process encoding, handler identity, deterministic behavior, budgets and source maps | Typed capability manifests, determinism/effect policy, bounded calls, authorization and source maps |

Both prohibit serialized JS closures and untrusted plugin installation; both require explicit
trusted package registration and compatible type/operation versions. If runtime fragments
become justified, separately decide capture-by-value versus references, lexical lifetime,
encoding and safety. Do not smuggle closures into IR or require that decision for P2.
Pure/restricted-effect profiles explicitly enumerate permitted capabilities and accounting.
Existing evaluators need an inventory before any broad determinism claim; profile selection
does not move effects, authorization or scheduling out of domain runtimes (CLK-08).

### Artifact, cache and trust boundaries

Create language/domain-owned data-only versioned artifact contracts, not serialized compiled
host objects or universal kernel IR. Expressions owns expression artifact semantics/compatibility;
shared envelope helpers may carry declarations/program IR, explicit binding and capability manifests,
nominal-type identities and source/provenance references. Source text/maps may be optional
sidecars with retention policy; diagnostics must still identify the responsible artifact and
domain path when source is unavailable. No live validators, runtime values or private brands
cross this boundary.

Admission validates shape, versions, allowed operations, depth/size and resource limits before
linking. Runtime linking resolves only authorized tenant registry entries. The Expressions runtime
executes its artifacts standalone without compiler/parser/authoring or unrelated providers, with no language
registration prerequisite for expression execution; current core compile/host prepare APIs are
not evidence that this new separation already exists.

Compile identity covers source, compiler/language/IR/profile/plugin/options, ordered binding/type
facts, schemas, components and all capability/nominal/codec metadata used in checking/lowering.
Link identity additionally covers runtime configuration/implementations and authorization partition
and generation. Each field's invalidation role needs a fixture; runtime values
are not compile-cache keys. Host caches are bounded and tenant-isolated. Content hashes do not
grant trust or replace admission, revocation checks or current authorization.

### Authoring and safety

Browser and VS Code/LSP are first-class thin clients over the same headless analysis, with
provider-routed mixed-context completion/hover/formatting and stable diagnostic codes, UTF-16 ranges, context,
document version and environment generation. Lazy editor loading must not contaminate headless
compile or runtime bundles. AI repair loops consume these diagnostics and revalidate against
current snapshots. Cancellation and stale results cannot publish or populate current caches.
IntelliJ gets a real plugin/transport compatibility spike, not a promise based on LSP branding.
Alias definitions/references span supported islands. Initial rename is single-document, lexical,
snapshot-atomic and capture/collision-safe; registry/dynamic/generated/cross-document renames
return unsupported with no edits. Formatting respects host delimiters; generated/many-to-one
source maps are not invertible and remain separate from input-data provenance (CLK-10/11).

Parsing, recovery, schema graphs, artifact admission, linking, evaluation, projection output,
diagnostics and caches all need bounds. Capability registries are trusted inputs, not source
imports; module design remains under #21. Email rendering needs its own escaping/URL policy;
EDIFACT decoding needs separate input provenance. Neither workflow must emit FSX. Client
validation never replaces server authorization or Formbar server rule enforcement.

## Architecture alternatives

| Alternative | Assessment |
| --- | --- |
| Bespoke parser/checker/tooling per domain | Fast locally, but duplicates ranges, recovery, types and AI/editor semantics; reject as the platform default |
| Integrated language framework | Potentially accelerates grammar/LSP work, but may couple AST ownership, runtime dependencies or editor lifecycle; evaluate a bounded spike, not assume incompatibility |
| Composed foundation | Proposed: preserves existing Kalada contracts and domain ownership, with independently deployable surfaces; costs explicit composition/provenance and conformance work |

P1 compares a representative framework slice on recovery, browser, mixed-source and dependency
fixtures. Stop if reuse is nominal or extraction regresses Kalada; no vendor is selected.

## Proposed phases and exit gates

Owners are proposed domains, not assignments or tracker status. Review PRD fixtures and
code principles at each phase; authoring may run parallel to artifacts. Fragments do not gate FSX.

### P0 — Contracts and open decisions

- **Owner:** Kalada architecture with Formbar, Scheman and Arbitre maintainers.
- **Dependencies:** review the PRD, this ADR, kernel contracts and conformance plan alongside
  current accepted ADRs; coordinate #92/#93 and #21.
- **Scope:** review minimum source/profile/provider/direct-location shape, compatibility inventory
  and proposed boundaries, not a public API or executable CF01/02/05 claim. Explore identity,
  outer aliases, shadowing and reorder; defer codecs/restricted handlers to Formbar #175.
  Record rejected unsafe designs and open spelling.
  Classify optional nominal/runtime-fragment and A/B work separately from ordinary FSX.
- **Acceptance evidence:** contract matrix, representative read/write/nested-scope sketches,
  current Formbar declaration mapping, threat model and list of explicit decisions/deferred items.
  Review CLK-01–15 feasibility, type compatibility inventory and parser ownership gaps early.
- **Exit gate:** request Kalada architecture and Formbar state/rules/FSX decisions or record
  explicit objections; approval is pending and this document is not cross-repo sign-off.
  Review a viable direct-reference path; do not hide known blockers until P5. This is not API
  freeze or executable safe-write proof. Trace: CLP-01–06, 08–10, 12; CLK-01–06; CF01/02/05.

### P1 — Prove the foundation with two consumers

- **Owner:** Kalada foundation/syntax maintainers; Formbar reviews scope/reference fit.
- **Dependencies:** P0 contracts.
- **Scope:** prove neutral source/context/recovery and equal public registration with a tiny
  domain-only language without Expressions. #146 proves bounded forward evidence; actual
  Expressions-hosted FSX reverse #153 is deferred beyond #142/#184; full CF01/#108 stays open;
  extract shared scope/type-identity services only when evidence demonstrates the need.
  Exercise reference/location distinctions without enabling domain writes.
- **Acceptance evidence:** existing Kalada conformance parity, malformed mixed-source/UTF-16
  fixtures, dependency graphs, and bounded comparison with an integrated framework slice.
- **Exit gate:** real reuse, equal provider access and preserved Expressions behavior are demonstrated;
  kernel/shared services have no expression imports. Bounded CF01-forward/#146 and partial
  diagnostic proof do not pass full CF01/02 or establish stable APIs/domain fit.
  CF03 may be deferred only as an explicit reviewed gap if nominal registration has no demonstrated
  consumer need; do not claim it passed. Revisit extraction if either fails. Trace: CLP-01, 02, 05, 06, 08, 12.

### P2 — Real FSX and minimum consumer probes

- **Owner:** Formbar compiler maintainers, with Kalada and Scheman integration reviewers.
- **Dependencies:** forward P1 evidence and P0 declaration/component/reference contracts;
  #179/#183 decisions before real #184 lowering, not reverse #153 or EDIFACT #112.
- **Scope:** provisional FSX compiler supports a small form, scoped read expressions, schema
  and component checking, deferred Kalada programs and source maps **after #179 decides**
  V1 replacement, dependency/cycle validation, old-data handling, runtime evaluation and
  path-to-source maps.
  No eager rendering, runtime fragment values or new reactive system.
  Add minimal EDIFACT → structured data → projection → Scheman and JSON → email model → safe
  renderer probes; fixtures need not deliver a production decoder/renderer. Review Arbitre effect
  ownership and Kuery fit/gaps without requiring a Kuery implementation. Prove safe writable
  direct non-repeater update mechanics under a narrow reviewed Formbar server policy in
  [#195](https://github.com/surikaterna/formbar/issues/195), independently audited before #123.
- **Acceptance evidence:** declaration validation/golden fixtures, nested read aliases,
  invalid attribute/child/type diagnostics, compile-time non-invocation and changing-input
  runtime tests without source recompilation; CF04–09 include both projection probes, Arbitre
  boundary, Kuery fit and CF05 Stage A computed/read-only/denied/stale/removed/conflict/unsupported
  rejection without mutation (including unsupported write-codec direction if applicable).
- **Exit gate:** Formbar executes the compiled declarations through its existing runtime path;
  compatibility gaps are resolved or explicitly block stability/release review. Tiny P1 fixtures
  cannot substitute for real consumption. Trace: CLP-02–07, 08, 11, 12.

### P3 — Portable runtime and cache boundary

- **Owner:** Kalada runtime/host maintainers and Formbar artifact consumers.
- **Dependencies:** P1 and concrete P2 declaration/program fixtures (not a hypothetical IR).
- **Scope:** data-only artifact codec, bounded admission, parser/compiler-free runtime linking,
  version matrix, source sidecars and host-owned tenant-safe cache identity/invalidation.
  Exercise explicit effect handoff to an authorized domain runtime without selecting optional A/B.
- **Acceptance evidence:** fresh-process/browser round trips, forbidden-import packed graphs,
  corrupt/version/capability/tenant negative fixtures and per-key cache invalidation tests;
  CF08/10/11/13/14 cover effect ownership, all version dimensions, packed surfaces and safety.
- **Exit gate:** runtime consumes artifacts without source tooling; no closures/private host
  authenticity cross the wire; hashes cannot bypass authorization. Trace: CLP-08–10, 12.

### P4 — First-class browser and LSP authoring

- **Owner:** Kalada analysis/tooling and Formbar authoring maintainers.
- **Dependencies:** P1/P2 mixed-source fixtures; may proceed in parallel with P3.
- **Scope:** shared headless analysis, lazy browser adapter, LSP/VS Code integration, AI
  validate–repair flow, and an actual IntelliJ compatibility spike.
- **Acceptance evidence:** identical browser/LSP diagnostics, completion and formatting,
  cancellation/currentness races, UTF-16 mixed-language edits, lazy bundle graphs and
  machine-diagnostic repair fixtures; CF12 includes alias navigation, limited safe rename,
  source-map ownership and explicit unsupported edits. Record IntelliJ plugin/version limitations.
- **Exit gate:** browser and VS Code are supported from one analysis authority; IntelliJ is
  supported only to the extent demonstrated, otherwise explicitly deferred. Trace: CLP-01, 08, 11, 12.

### Pre-freeze review gate — after P1/P2/P3/P4 evidence, before stability claims

- **Owners:** Kalada architecture and the real consuming domain/tooling maintainers.
- **Required evidence:** CF01–14 outcomes or explicit blocking gaps: Kalada regressions and tiny
  composition, real FSX, both projection probes, Arbitre ownership/handoff, Kuery fit assessment,
  portable/packed runtime, currentness and authoring. Require an executable CF05 safe-write proof
  for direct non-repeater writes from Formbar #195, independently audited: computed/read-only,
  denied/stale/removed/conflicting/unsupported targets reject without mutation and unsupported
  write-codec direction rejects where applicable. #180/#185 do not block #123 when repeater
  writes are disabled/excluded; current #187 requires Stage B, P6 if repeater writes are released.
  A reviewed CF03 deferral is allowed only if real FSX/projection consumers do not need nominal
  registration; if they do, executable CF03 proof is required before public API stability.
  CF02/04/13 must prove provider parity, Expressions-free minimal tooling, public FSX composition,
  neutral dependency graphs and standalone precompiled Expressions runtime independence.
- **Decision:** [#123](https://github.com/surikaterna/kalada/issues/123) records/reviews minimum
  contracts against real consumers; the public API stays open/unfrozen, even on passing evidence.
  P0 sketches/P1 toy mechanics alone are insufficient. Do not depend on full P5 completion: that
  would make the contracts P5 needs depend cyclically on P5. Qualitative safety precedes review;
  calibrated resource budgets remain the P6/#87 release gate.

### P5 — Writable scopes and supported domain completion

- **Owner:** Formbar state/rules maintainers; projection and domain decoder/renderer owners.
- **Dependencies:** P0/P1 reference findings, P2 compiler, P3 artifacts and P4 analysis contracts.
- **Scope:** complete agreed domain contracts and nominal-type registration, nested writable
  repeater scopes and stable item identity in current Formbar #187; exercise EDIFACT → data →
  mapping → Scheman command and JSON → email model → safe renderer beyond the P2 probes.
- **Acceptance evidence:** reorder/removal/shadowing/stale-write tests, codec/update-policy
  rejection tests; [Formbar #187](https://github.com/surikaterna/formbar/issues/187) requires #180
  identity and independently audited #185 Stage B proof; server/client parity and renderer security tests.
- **Exit gate:** Formbar approves update policy before enabling writes; server enforcement
  remains authoritative. Optional executable fragments/A/B require a separate decision only
  if justified; they do not retroactively gate P2. Trace: CLP-03–07, 09, 11, 12.

### P6 — Resource budgets, compatibility and release readiness

- **Owner:** package/release maintainers, security reviewers and consuming application maintainers.
- **Dependencies:** P3–P5 supported surfaces; authoritative measurement follows #87 prerequisites
  and final package policy, including the work currently in PR #82.
- **Scope:** calibrated bundle/compute thresholds, hostile-input admission bounds, tenancy,
  producer/consumer compatibility and migration/rollback guidance for supported deployments;
  repeater writes require Stage B if selected for release; unsupported writes cannot be marked supported.
- **Acceptance evidence:** pinned packed artifacts, module graphs, initial/lazy/total sizes,
  reproducible raw performance samples and reviewed threshold derivation; capability revocation,
  tenant-isolation and old/new artifact compatibility matrices.
- **Exit gate:** measured budgets and compatibility/security gates pass; unstable metrics remain
  report-only. No invented numeric SLO or automatic baseline increase. Trace: CLP-01–12.

## Migration and existing authority

This proposal does not blanket-replace accepted ADRs:

- [ADR-0001](./0001-kalada-language-architecture.md) remains authoritative for canonical
  expression contracts, deterministic core and host effects. Domain-owned ASTs compose those
  expressions; these remain Expressions compatibility obligations, not universal kernel semantics.
  Any runtime extension needs a targeted amendment, not reinterpretation.
- [ADR-0002](./0002-explicit-time-semantics.md) and
  [ADR-0003](./0003-deterministic-general-functions.md) retain time/function constraints;
  fragment capture does not silently override them.
- [ADR-0004](./0004-deterministic-projection-v1.md) retains projection semantics and bounds;
  “thin consumer” does not mean removing its domain responsibilities.
- [ADR-0005](./0005-deterministic-navigation-operators.md) retains expression operator semantics.
- [ADR-0006](./0006-prepared-execution-schema-tooling.md) retains schema/semantic separation,
  host orchestration and currentness. P3 proposes an additional portable runtime boundary;
  it does not claim its current prepared objects are portable or remove public APIs.
- ADR-0007 remains unmerged in PR #82; respect its eventual package-policy decision before release.

Preserve existing APIs and conformance while extracting internally. Introduce new contracts
additively where possible; unavoidable semantic/package breaks require explicit versions,
migration evidence and targeted ADR updates. #21 owns modules/imports and is not an initial
FSX blocker; #75 owns orthogonal Standard Schema capabilities, not component registries.
An incompatible publishable Formbar V1 replacement requires a major Formbar Changeset, not
automatically a Kalada package change. Future versioned portable artifacts remain a separate target.
## Review and validation of this proposal

Review CLP acceptance against the per-direction conformance ledger; full CF01 and CF02–14
remain unpassed. This docs-only change implements no runtime behavior or cross-repo approval.

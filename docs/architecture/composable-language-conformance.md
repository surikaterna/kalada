# Composable language conformance plan

- Status: Draft / Proposed — every scenario is **PLANNED — NOT RUN**.
- Date: 2026-09-23
- Product requirements: [PRD CLP-01–12](../prd/composable-language-platform.md).
- Behavioral contracts: [kernel CLK-01–15](./composable-language-kernel-contracts.md).
- Delivery and authority: [ADR-0008](../adr/0008-composable-language-platform.md).
- No assigned issue or tracker update; Formbar #92/#93 and Kalada #21/#75/#87 are coordination only.

## Evidence policy and gate vocabulary

This is a future harness/evidence plan, not runnable tests or passing conformance. All commands
are **TBD during implementation**; no command below is implied to exist. Owners are accountable
domains proposed for review, not assignments. Each result must record source/artifact fixtures,
environment/version/profile identities, expected and actual output, negative diagnostics,
dependency evidence where relevant, and reproducible harness commands before becoming evidence.

P0 reviews contract feasibility. P1 proves Kalada regression parity and tiny bidirectional
composition mechanics, including a bounded framework comparison. It cannot establish real
consumer fit or freeze an API. P2 exercises real FSX and minimal projection probes, with Arbitre
boundary and Kuery fit reviews. P3 proves portable runtime/effect/cache boundaries; P4 authoring
runs in parallel with P3. The **pre-freeze review** follows P1–P4 evidence and a safe writable
reference proof, not full P5 completion. It permits a stability review, never automatic freezing.
P5 completes supported domains/writes; P6 gates measured release readiness. Unsupported cases
must be explicit failures/limitations, not silently omitted fixtures. Optional fragments/A/B do
not gate ordinary declarations with deferred expressions.

## Matrix

Each row includes positive and negative scenarios targeted to its listed contracts. Detail below
is part of the row's evidence obligation, not an optional appendix. Status applies to every probe.

| ID / probe | Product / kernel coverage | Proposed owner | First phase → required gate | Status |
| --- | --- | --- | --- | --- |
| CF01 Mixed parser | CLP-01, 12; CLK-01, 02, 15 | Kalada source | P1 → pre-freeze | PLANNED — NOT RUN |
| CF02 Provider parity / Expressions | CLP-02, 04; CLK-03, 06, 08 | Kernel / Expressions / Scheman adapter | P1 → pre-freeze | PLANNED — NOT RUN |
| CF03 Nominal registration | CLP-06; CLK-06, 07 | Kalada + test domain | P1 → pre-freeze | PLANNED — NOT RUN |
| CF04 Real FSX | CLP-03, 04, 05; CLK-03, 04, 08, 09 | Formbar / Kalada / Scheman | P2 → pre-freeze | PLANNED — NOT RUN |
| CF05 Writable identity | CLP-05, 04; CLK-04, 05 | Formbar state/rules | P1 feasibility, P2 proof → pre-freeze; P5 completion | PLANNED — NOT RUN |
| CF06 EDIFACT projection | CLP-07; CLK-09, 11, 15 | Projection / decoder / Scheman | P2 → pre-freeze; P5 completion | PLANNED — NOT RUN |
| CF07 Email projection | CLP-07, 12; CLK-08, 09, 15 | Projection / email renderer | P2 → pre-freeze; P5 completion | PLANNED — NOT RUN |
| CF08 Arbitre handoff | CLP-03, 09, 12; CLK-08, 09, 12 | Arbitre / Kalada runtime | P2 assessment, P3 probe → pre-freeze | PLANNED — NOT RUN |
| CF09 Kuery fit | CLP-02; CLK-03, 06, 09 | Kuery / Kalada architecture | P2 → pre-freeze | PLANNED — NOT RUN |
| CF10 Wire/version | CLP-06, 08, 09, 10; CLK-01, 07, 12 | Kalada runtime / Formbar artifacts | P3 → pre-freeze; P6 version window | PLANNED — NOT RUN |
| CF11 Cache/currentness | CLP-10, 11, 12; CLK-01, 13 | Kalada host / domain hosts | P3 → pre-freeze; P6 tenancy | PLANNED — NOT RUN |
| CF12 Authoring/maps | CLP-01, 05, 11; CLK-04, 10, 11 | Headless tooling / browser / LSP | P4 → pre-freeze | PLANNED — NOT RUN |
| CF13 Packed surfaces | CLP-02, 08, 11; CLK-03, 10, 14 | Package / consumer maintainers | P3/P4 → pre-freeze; P6 budgets | PLANNED — NOT RUN |
| CF14 Hostile input | CLP-12; CLK-02, 07, 08, 12, 13, 15 | Security + each phase owner | P1 onward → pre-freeze safety; P6 measured release | PLANNED — NOT RUN |

## Targeted scenarios and required evidence

### CF01 — Mixed parser and phase lifecycle

- **Positive:** Kalada and a tiny independent language nest in both directions. Explicit profiles
  shield quoted delimiters, comments and nested regions; CRLF/non-BMP ranges remain half-open
  UTF-16. Demonstrate owned source/trivia preservation without requiring every language to build
  a full lossless CST. Child exit and host validation advance predictably.
- **Negative:** reject ambiguous registration and invalid/non-progress exit ranges. Unterminated
  strings/comments and malformed islands stop at approved boundaries without swallowing sibling
  host structure. Deep alternating islands consume one shared budget. Invalid/partial, stale,
  unsupported, cancelled and exhausted results cannot emit; deserialized CST without admission
  cannot borrow current `WeakMap` provenance.
- **Evidence:** range/ownership goldens, phase-state table, shared-budget counters and bounded
  recovery comparison with a representative integrated framework slice. Record unresolved lexical
  pairs as unsupported, not successes. Harness command: TBD during implementation.

### CF02 — Equal providers and Expressions compatibility

- **Positive:** run existing Kalada conformance before/after extraction, including canonical
  operators/diagnostics and admitted profiles; trace Expressions' use of neutral scope/type-identity
  infrastructure. Expressions and a minimal domain language register through identical public
  interfaces with equal service access. Run the domain language and its headless tooling without
  installing/registering Expressions; its own type rules must work without Expressions semantics.
  Separately opt into composition: expected-type slots reuse the public Expressions checker. Demonstrate richer
  schema facts mapping to existing executable semantics or remaining domain-only facts.
- **Negative:** incompatible expected types and value-as-location fail without a copied checker.
  Attempted implicit coercion, unbounded type substitution and unsupported executable use of
  record/optional/alternative evidence are rejected rather than inventing null/record/union
  semantics. Operations not verified for a pure profile cannot acquire that designation by default.
  Fail privileged Expressions hooks, required default expression registration, expression-specific
  assignability imposed by kernel services, or kernel/shared-service imports of expression syntax,
  checker, IR or evaluator (including transitive imports).
- **Evidence:** regression diffs, dependency/code-path review, explicit supported/excluded generic
  inventory and checked-to-IR mapping/rejection table. Any canonical change requires separate
  approval under Expressions compatibility policy. Include registration/access parity traces and
  dependency assertions for the independent consumer. Harness command: TBD during implementation.

### CF03 — Nominal registration without domain coupling

- **Positive:** a trusted test package registers versioned nominal IDs, finite arguments and an
  explicitly portable codec; equal registration generations yield equal checking decisions.
  Demonstrate language-owned structural versus nominal assignment without kernel/Expressions Formbar imports.
- **Negative:** reject equal-shaped but different nominal identities, bad argument arity,
  conflicting versions, unknown operations/codecs and source-supplied registration callbacks.
  A valid local-only nominal value fails portable admission; no built-in fragment type is added.
- **Evidence:** registry/assignability goldens, immutable-generation tests and portable/local-only
  admission pair. This does not require runtime fragment capture. Command: TBD during implementation.

### CF04 — Real FSX consumer, not a toy substitute

- **Positive:** compile a minimal field/output/conditional form with nested explicit aliases,
  component and Scheman facts into existing Formbar declarations and deferred Kalada programs.
  Use the real declaration validator/runtime integration with a documented expression adapter;
  changing input changes output without recompiling. Equivalent client/server rule fixtures agree.
  FSX explicitly composes the public Expressions provider/compiler; trace Formbar scheduling calls
  to the Expressions runtime with deferred artifacts, not kernel evaluation of a whole form.
- **Negative:** reject invalid children, attribute types, unknown components/capabilities, duplicate
  aliases and unresolved references. Spies detect any compile-time evaluation, rendering or
  capability invocation. A browser authorization claim cannot bypass server checks.
  Reject reliance on private compiler hooks, privileged provider registration or a kernel evaluator.
- **Evidence:** source/declaration goldens, actual consuming runtime output, scope resolution and
  compatibility report. Tiny CF01 mechanics cannot satisfy this row. Command: TBD during implementation.

### CF05 — Writable reference proof before freeze review

- **Positive:** nested repeated records expose distinct inner/outer aliases. A checked, data-only
  location descriptor updates the same stable item after reorder, under a minimal reviewed host
  update policy with explicit read/write codec directions. Full scope recomputation clears removed
  references; any optional incremental index equals that baseline after edits.
- **Negative:** reject computed-value writes, index-retargeting, removed/stale items, denied writes,
  revision conflicts and read-only codecs. Test duplicate declarations and capture/shadowing errors;
  names/runtime slots cannot stand in for stable entity identity.
- **Evidence:** location descriptor traces and authorized update/rejection outcomes using a narrow
  Formbar integration or reviewed host-policy probe, not a production write UI. P1 sketches alone
  are insufficient; executable safe identity/update proof is required before pre-freeze review.
  Field syntax and complete P5 write behavior remain open. Command: TBD during implementation.

### CF06 — EDIFACT projection and three kinds of provenance

- **Positive:** a small structured-interchange decoder fixture (EDIFACT) yields data with segment/element provenance;
  real projection contracts map it into a command validated through Scheman. Show successful
  mapping and trace input location, mapping-source range and output validation path separately.
- **Negative:** decoder errors, mapping errors and invalid commands retain distinct attribution;
  missing provenance uses an explicit path fallback, not a fabricated source offset. Output-growth
  limits terminate mapping without invoking Formbar scheduling.
- **Evidence:** bounded decoder fixture, mapping/command snapshots and diagnostic lineage table.
  No full production EDIFACT decoder or FSX output is required. Command: TBD during implementation.

### CF07 — JSON-to-email boundary

- **Positive:** Expressions public contracts project representative JSON into a typed email domain model;
  a minimal renderer fixture escapes text and enforces explicit safe URL/markup policy.
- **Negative:** hostile markup/URLs are rejected or escaped by the renderer, even when expression
  checks pass. Excessive output is bounded; compiling a mapping never invokes rendering, effects
  or Formbar reactivity. Nonpermitted capabilities fail the selected profile.
- **Evidence:** model goldens, escaped/rejected output and independent renderer security checks.
  A production mail service or complete renderer is not required. Command: TBD during implementation.

### CF08 — Arbitre effect handoff

- **Positive:** P2 reviews a representative workflow's requirements; P3 passes admitted deferred
  expressions and explicit effect requirements to a narrow authorized Arbitre boundary probe.
  Observe that the domain runtime, not parser/compiler, selects execution/scheduling and budgets.
- **Negative:** pure-context effect use, missing/revoked capability and unsupported runtime
  requirements fail before effect callbacks. Compile/link probes distinguish validation from
  execution; no new Kalada scheduler is introduced.
- **Evidence:** ownership review, capability/profile manifest and callback/order counters. A/B
  opcodes need not be chosen; any later A/B probe belongs to its selected language/domain runtime,
  not universal kernel execution. Full workflow delivery is not a gate. Command: TBD during implementation.

### CF09 — Kuery fit assessment only

- **Positive:** map representative query expression, binding and collection/type expectations
  to neutral kernel contracts and optional Expressions contracts/semantics; identify reuse explicitly.
- **Negative:** document a non-fitting domain construct and its rejection/domain-lowering boundary,
  especially if it would need unsupported generics, semantics overrides or execution authority.
- **Evidence:** reviewed fit/gap table with input examples and expected decisions, including
  “unsupported” where necessary. No Kuery compiler/runtime is required; any later harness command
  is TBD during implementation. This is assessment evidence, not executable Kuery conformance.

### CF10 — Wire and version admission

- **Positive:** a real P2 declaration/program fixture survives encode/decode into a fresh process
  and browser through public runtime APIs. Supported producer/consumer pairs explicitly map
  language, IR, profile, plugin, registry, schema and nominal/codec requirements; compiler
  provenance remains separate from runtime compatibility.
- **Negative:** malformed nodes, missing bindings, unknown versions/requirements, live registries,
  closures, nonportable nominal values and existing host compiled objects fail before callbacks.
  A partial checked result cannot be dressed up as an emitted artifact.
- **Evidence:** version matrix with positive and negative entries for each requirement dimension,
  callback counters, wire fixtures and fresh-consumer logs. Commands: TBD during implementation.

### CF11 — Cache identity and bounded currentness

- **Positive:** unchanged facts reproduce compile identity; changing runtime values alone reuses
  compilation. Change each checking/lowering input independently: bindings/types, schema,
  component/capability metadata, nominal/codec facts, compiler/language/IR/profile/plugin/options.
  Link tests vary runtime config, implementation versions and authorization partition/generation.
- **Negative:** unchanged source with changed environment is stale. Revocation, tenant crossover,
  unknown compatibility, cancelled results and admission-bypassing cache hits fail closed.
  Exercise bounded eviction, including stale entries, without treating hashes as authority.
- **Evidence:** per-field compile/link invalidation table, race logs and authorization-at-use
  assertions. Commands: TBD during implementation.

### CF12 — Authoring, ownership and source maps

- **Positive:** browser, LSP and AI clients agree on diagnostics/completion/hover, alias
  definitions/references across supported islands and safe single-document lexical rename.
  Rename edits are atomic and snapshot-bound. Formatting preserves host delimiters and unowned
  text. Composed many-to-one/generated mappings retain language ranges or explicit path fallback.
- **Negative:** reject stale/cancelled edits, collisions/capture, overlapping formatter edits and
  reverse edits through noninvertible maps. Registry/dynamic/generated/cross-document rename is
  explicitly unsupported with zero edits. Removing declarations cleans reference indexes.
- **Evidence:** shared-client query/edit goldens, UTF-16 tests, stale AI repair/revalidation trace,
  map composition fixtures and actual IntelliJ compatibility/limitation report. Cross-language
  source maps do not substitute for CF06 data provenance. Commands: TBD during implementation.

### CF13 — Packed dependency surfaces

- **Positive:** fresh Node/browser consumers install packed artifacts and use public exports:
  Expressions runtime alone executes precompiled expression artifacts without compiler/parser,
  authoring, language registration or unrelated providers; compiler runs headlessly, authoring lazily.
  A separate minimal domain consumer installs kernel/shared tooling without the Expressions package
  and serves analysis queries through public provider registration. FSX explicitly installs/composes
  Expressions through public APIs, rather than receiving an implicit kernel dependency.
- **Negative:** fail forbidden transitive parser/compiler/editor imports in runtime, editor/LSP
  imports in compiler, eager authoring chunks, or reliance on workspace/internal source aliases.
  Fail kernel/shared-service imports of Expressions syntax, checker, IR or evaluator; fail runtime
  dependencies on source providers or mandatory authoring registration. Shared low-level helpers
  are permitted only when their graphs remain language-neutral, with no kernel-to-language coupling.
- **Evidence:** pinned packed packages, dependency graphs, browser metafiles with initial/lazy/total
  chunks, explicit forbidden-import assertions and isolated install logs for both independent
  consumers, plus public FSX composition traces. Existing host is not presumed compliant;
  thresholds await #87/P6. Commands: TBD during implementation.

### CF14 — Hostile input across the whole pipeline

- **Positive:** near-limit valid mixed source, schema/type graphs, IR and projection output finish
  within configured qualitative budgets, preserving tenant boundaries and sanitized diagnostics.
- **Negative:** cyclic/deep schemas, nested islands, recovery floods, substitution/lowering work,
  malicious artifact payloads, oversized outputs and cache floods stop with bounded stable codes.
  Untrusted registration and disallowed effects fail; shared nesting budgets cannot reset at
  language entry. Cancel during parse/check/lower/admit/link/evaluate and verify no publication.
  Test secret-bearing context never appears in diagnostic payloads and revocation is honored.
- **Evidence:** phase-by-phase accounting/cancellation table, diagnostic count/size bounds and
  cross-tenant assertions. P6 adds calibrated numerical thresholds and reproducible measurements
  under #87; unstable timing is report-only. Commands: TBD during implementation.

## Review record required before stability decisions

Reviewers must attach CF01–14 outcomes or explicit blocking gaps, including real CF04 consumption,
both projection probes, CF08 ownership, CF09 fit, portable/packed execution, authoring and CF05 safe
write proof. P5 completion cannot be a prerequisite for deciding the contracts P5 needs. Review
also requires CF02/04/13 provider parity, Expressions-free tooling, neutral dependency graphs,
public FSX composition and standalone Expressions runtime evidence, not merely a parser-free bundle.
The gate may reject or revise the design; it does not choose optional fragments, final spellings or versions.
These planned scenarios are risk-based future tests; validating these four documentation files
does not execute them or change any issue status.

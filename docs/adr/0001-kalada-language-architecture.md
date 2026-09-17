# ADR-0001: Kalada language architecture and extraction contract

- Status: Accepted
- Date: 2026-09-16
- Decision sources: [Kalada #1](https://github.com/surikaterna/kalada/issues/1) and
  [Formbar #93](https://github.com/surikaterna/formbar/issues/93)

## Context

Kalada will provide portable, deterministic expression contracts shared by Kuery, Formbar,
and potentially Arbitre. The architecture must preserve runtime identity during extraction,
keep source tooling out of runtime dependency graphs, and avoid treating workflow or host
effects as language semantics. Kalada is a custom expression-oriented language, not a
TypeScript subset.

This ADR freezes ownership and compatibility direction before semantics are implemented. The
bootstrap creates only an empty `@kalada/core` shell. Every language feature described below
is a boundary for later work, not an implementation in Kalada #1.

## Decision

### Canonical contract and versioning

The canonical, explicitly versioned AST is the durable runtime and interchange contract.
Source text is optional input tooling, never the canonical representation. The AST envelope,
node variants, value encoding, capability manifest, diagnostics, limits, and compatibility
policy will each have explicit versions or version-bearing fields before extraction.

There will be one canonical AST shared by all Kalada layers. Syntax lowering and projection
must consume that contract rather than define competing expression trees. Source grammar,
CST, formatter behavior, and source maps are versioned independently from the AST so syntax
can evolve without silently changing stored expressions.

`Option`, `Result`, and exhaustive `match` are future explicit language concepts. Their wire
encoding must be collision-safe: ordinary user objects cannot be mistaken for tagged values.
The precise tag namespace and evolution rules are deferred until the serialized value contract
is designed.

### Package ownership and dependency direction

The intended package graph is:

```text
@kalada/syntax ----> @kalada/core <---- @kalada/projection
```

- `@kalada/core` owns the canonical AST and, when separately implemented, the value/type
  model, profiles, compiler, evaluator, diagnostics, dependency descriptions, capability
  declarations, and resource limits. It has zero runtime dependencies.
- `@kalada/syntax` will optionally own parsing, a lossless CST, lowering to the canonical AST,
  source maps, formatting, and static source checks. Parser, CST, LSP, and editor dependencies
  must not enter runtime package graphs.
- `@kalada/projection` will optionally own bounded deterministic JSON projection definitions.
  It consumes core contracts and does not expand the evaluator into a template engine.

Only `@kalada/core` is created during bootstrap. Syntax and projection packages remain absent
until their own implementation issues begin. Core never imports them, and neither optional
package may create another AST or evaluator.

### Security and host boundaries

Arbitrary JavaScript is not a compatibility goal. Evaluation cannot use `eval`, `Function`,
ambient globals, prototype traversal or mutation, or unvalidated host callbacks. Serialized
programs and values are data, not executable JavaScript. Property access must eventually have
an explicit own-data-property policy that excludes prototype pollution paths.

Network access, mutation, persistence, retries, transactions, scheduling, UUID/random
generation, and other effects remain host-owned. Any future host interaction must cross a
typed, allowlisted capability boundary represented in the evaluation contract. Parser and
editor tooling are likewise not runtime capabilities.

### Determinism and resource boundaries

Evaluation is synchronous and deterministic for a versioned AST, profile, declared capability
inputs, and limits. No evaluator-owned asynchronous work, scheduler, implicit I/O, or mutable
ambient state is permitted. Hosts select profiles and provide capabilities explicitly.

Every future evaluator entry point must apply bounded resource accounting. The contract will
cover at least AST depth and node count, operation budget, collection size, string and encoded
value size, function call depth, diagnostic count, and projection output growth. Bounded
collection operators and projections consume the same evaluation budget. Exact defaults,
override policy, and diagnostic codes are deferred to the limits contract.

### Temporal boundary

Initial temporal support is limited to `Instant` and `Duration`. A host-provided clock
capability is sampled at most once per evaluation; the sampled value becomes replayable input.
There is no ambient current time, timer, delay, recurrence, or implicit scheduling. Calendar,
locale, timezone, and civil-date types are deferred.

### Function boundary

Initial user functions will be pure, typed, named, first-order, non-recursive, serializable,
and statically acyclic. Lambdas are initially non-escaping and accepted only by an allowlist of
bounded collection operators. Closures over ambient state, dynamic calls, unbounded recursion,
and host function serialization are excluded.

ADR-0003 supersedes only this function boundary. All other decisions in this ADR remain in
force.

### Projection boundary

Projection is a separate deterministic transformation layer over JSON-compatible data and core
expressions. It must define bounds for traversal, iteration, merge behavior, and output growth.
Before claiming SelectTransform compatibility, differential fixtures must define missing,
`undefined`, `null`, `false`, `0`, empty string, empty array, and empty object behavior; exact
substitution versus interpolation; conditional chains; iteration scope; optional keys;
merge/flatten/include/let behavior; and host packaging. Existing truthiness and arbitrary
JavaScript behavior must not be inherited accidentally.

### Extraction and compatibility direction

Extraction follows released artifacts rather than in-repository substitution:

1. Freeze the AST envelope, values, capabilities, diagnostics, limits, and compatibility
   policy.
2. Extract Kuery's released strict-expression kernel and conformance fixtures into
   `@kalada/core` without adding language features during extraction.
3. Change Kuery expression exports to direct Kalada re-exports while preserving runtime
   constructor and profile identity.
4. Keep Formbar importing through Kuery for one compatibility release, then migrate
   `@formbar/expressions` to direct Kalada imports.
5. Evaluate direct Arbitre adoption separately. Its scheduler, TMS, effects, writes, and clock
   integration remain Arbitre-owned.
6. Add algebraic data types, time, functions, bounded lambdas, projection, and syntax only in
   their dependency order and through separate issues.

Clean-consumer fixtures and cross-package identity tests are required before compatibility is
claimed. Compatibility windows and deprecation duration are deferred until the extracted
contract has a version.

### Release boundary

Changesets records publishable changes. The repository's protected GitHub Actions workflow is
the only publication path: npm trusted publishing uses OIDC, provenance, and no long-lived npm
token. This bootstrap does not publish or create a release.

Future registry verification or reconciliation, if needed, must use bounded retries, reject a
conflicting artifact immediately, and be safe to rerun without republishing an existing
version. This records the delayed-registry lesson from Formbar #96 without adding premature
reconciliation machinery.

## Explicit non-goals

This decision does not implement an AST, parser, CST, grammar, compiler, evaluator, profile,
operator, function, temporal type, projection, formatter, LSP, effect system, scheduler, Kuery
extraction, Formbar migration, publication, or repository release. It does not promise
JavaScript, SelectTransform, database-query, workflow, async, mutation, or scheduling semantics.

## Deferred decisions

Later ADRs must choose the AST and source version formats; exact node and value encodings;
collision-safe ADT tags; type and numeric semantics; diagnostic schema; capability manifest;
resource defaults; profile and operator sets; property-access rules; compatibility window;
temporal serialization; function and lambda syntax; projection schema; parser grammar; and
release reconciliation only if operational evidence requires it.

## Consequences

Core consumers can rely on a small runtime graph and one eventual canonical contract. Optional
tooling and projection can evolve without burdening runtime users. In exchange, feature work
must wait for explicit contracts, extraction requires identity and clean-consumer evidence, and
hosts retain responsibility for all effects and scheduling.

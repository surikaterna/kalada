# ADR-0006: Prepared execution, schema environments, and language tooling

- Status: Accepted
- Date: 2026-09-20
- Decision source: [Kalada #70](https://github.com/surikaterna/kalada/issues/70)
- Architecture context: [ADR-0001](./0001-kalada-language-architecture.md),
  [ADR-0002](./0002-explicit-time-semantics.md),
  [ADR-0003](./0003-deterministic-general-functions.md),
  [ADR-0004](./0004-deterministic-projection-v1.md), and
  [ADR-0005](./0005-deterministic-navigation-operators.md)
- Syntax authority: [Kalada #8](https://github.com/surikaterna/kalada/issues/8)
- Deferred module authority: [Kalada #21](https://github.com/surikaterna/kalada/issues/21)
- Researched baseline: `fbf6dac0b219dfece328be3616c16dc525b7efe1`

## Context

The public `@kalada/syntax` boundary parses source into a lossless CST, lowers it to the canonical program,
formats it, and maps canonical paths back to source. At the researched baseline, syntax infers a static type
internally but public lowering omits it. Public `@kalada/core` canonicalizes, compiles, reports dependencies,
and evaluates synchronously; its compiled artifact exposes no result type. This is a tooling capability gap,
not permission for host to duplicate inference.

Repeated browser and server evaluation should not repeat source work or environment linking.
Schema libraries also expose different capabilities: validation does not necessarily expose
recursive editor structure, and neither capability decides Kalada operator semantics. The host
boundary must preserve these distinctions while supporting manual inputs and optional adapters.

This ADR extends the ownership and deterministic evaluation rules of ADR-0001 through ADR-0005. It
does not alter the canonical `kalada-v1` language, syntax decisions owned by #8, or modules deferred
to #21. It optimizes for deterministic diagnostics, reusable browser/server artifacts, schema
neutrality, browser safety, and one headless service shared by CodeMirror and future VS Code/LSP
clients.

## Execution lifecycle

### Five phases

The host pipeline has exactly five conceptual phases:

1. **Describe environment.** An explicit provider input is normalized into an immutable environment
   snapshot containing compile-time binding descriptions and capability declarations.
2. **Parse.** Source is parsed into a lossless CST with syntax diagnostics and source coordinates.
3. **Compile template.** Lowering produces a canonical program and source map; core compilation then
   produces ordered dependencies and the reusable core artifact.
4. **Link/prepare.** Ordered dependencies are resolved against the normalized environment into an
   immutable host plan and diagnostic indexes. No runtime value is read or captured.
5. **Evaluate values.** Values are validated, explicitly transformed, bound in link-plan order, and
   passed to the synchronous core evaluator.

```text
provider input -> normalized environment
source -> parse/CST -> lower/canonical program + source map
       -> core compile + ordered dependencies
compiled template + normalized environment -> immutable linked/prepared host plan
prepared plan + values -> validate/transform/bind -> synchronous core evaluate
```

A future publishable additive syntax API must expose its authoritative static result projection as
`KaladaSyntaxStaticType = "dynamic" | KaladaType`. Host compile/prepared artifacts consume that exact projection
and never reimplement inference. Until then, they have no inferred result type and the demo display is unavailable.

The one-shot and prepared APIs are different entry points into this exact pipeline, not different
implementations. Conceptually, the public API is:

```ts
const result = evaluateExpression(source, provider, values);

const prepared = prepareExpression(source, provider); // phases 1-4 once
const first = prepared.evaluate(firstValues);          // phase 5 each time
const second = prepared.evaluate(secondValues);

const environment = describeEnvironment(provider);
const parsed = parseExpression(source);
const compiled = compileExpression(parsed, environment.compileProjection);
const linked = linkExpression(compiled, environment);
const advancedResult = linked.evaluate(values);
```

`evaluateExpression` delegates to preparation and evaluation. `prepareExpression` composes the
same public parse, compile, and link operations shown by the advanced API. Implementations must not
introduce a one-shot-only lowering rule, diagnostic, cache, or evaluator. Advanced callers retain
direct syntax/core APIs as well as explicit host compile and link entry points.

Compilation consumes only immutable facts, including stable reference identity and the authoritative
`KaladaSyntaxStaticType` projection once public. Linking resolves ordered dependencies to normalized slots and
capabilities. Expressions may reuse one environment, but evaluation reads only linked dependencies in order. A
missing linked binding is a link diagnostic; a missing value is a binding diagnostic.

### Artifact identity, reuse, and state

Compiled and prepared artifacts are recursively immutable and reentrant. A compiled artifact may retain the CST,
canonical program, source map, core compilation, ordered dependencies, and source/diagnostic indexes; it may retain
the syntax-owned result projection only after the public extension exists. A prepared artifact may also retain
normalized schema/type projections and a link plan. Inspectors return immutable views, never mutable internals.

Prepared artifacts contain no runtime values, mutable provider state, prior outcomes, clocks,
random sources, or per-evaluation counters. Each evaluation receives fresh values and fresh core
limits/counters. Concurrent or nested uses of one prepared artifact cannot observe one another.

A **compile fingerprint** digests canonical source/program input, parse/lower options, syntax and canonical/core
contract versions, profile, and ordered binding identities plus semantic projections. A **link/capability
fingerprint** digests it with binding order/paths, editor-shape/schema versions, link slots, and every
provider/validator/codec identity and configuration. Digests never use object/function identity, values, secrets,
timestamps, or process state.

Cacheable providers declare stable `providerId`, `providerVersion`, and deterministic `configurationDigest`; each
capability has stable identity/version covered by that or a nested digest. Missing identity remains usable but is
non-cacheable across preparations/processes and emits no reusable link fingerprint. Changed source, options,
contracts, profile, or semantic projection invalidates compilation; changed binding, shape, provider, capability,
codec, or configuration identity invalidates linking. Incompatibility is rejected rather than silently relowered.
Callers may own bounded caches; Kalada owns no hidden cache, global registry, ambient lookup, or process singleton.

### Synchronous and asynchronous hosts

Core compilation and evaluation remain synchronous. Every sync host API accepts only capabilities
declared as synchronous. A provider, validator, transformer, or codec declared async is rejected
before invocation with a stable host diagnostic. If a supposedly synchronous capability returns a
Promise or thenable, the sync path rejects it deterministically, does not await it, and does not
enter core evaluation.

Async behavior is explicit rather than return-type polymorphism:

```ts
const result = await evaluateExpressionAsync(source, asyncProvider, values);
const prepared = await prepareExpressionAsync(source, asyncProvider);
const next = await prepared.evaluateAsync(values);
```

Async preparation may await provider normalization before running the same synchronous parse,
compile, and link logic. Async one-shot and `evaluateAsync` validate and transform sequentially in
link-plan order, await each declared async capability, finish binding, and then invoke the exact
same synchronous core evaluator. There is no async core evaluator, parallel validation, or Promise
in a core value or resolver.

For each ordered dependency, evaluation performs exactly this pipeline:

1. read the value as an own data property; inherited, accessor, or absent input does not bind;
2. run the provider/Standard Schema input validator-decoder once, using its successful output next;
3. run the separately declared Kalada conversion/codec, if any;
4. perform final Kalada value validation and, for a known projection, semantic-type validation;
5. recursively freeze the value and bind it to the immutable evaluation environment.

After every dependency binds, synchronous core evaluation begins; Standard Schema is not run again after
conversion. Per-binding precedence is missing/invalid own-data lookup, decode, explicit conversion, then final
Kalada value/semantic validation. The first failing dependency in link-plan order wins; nothing later runs. Only
explicit async APIs may await steps 2 or 3. The respective bind diagnostic categories are
`HOST_BINDING_MISSING`, `HOST_BINDING_DECODE`, `HOST_BINDING_CONVERSION`, and `HOST_BINDING_SEMANTIC`.

### Diagnostics and precedence

A host diagnostic is recursively immutable and conceptually has this envelope:

```ts
type HostDiagnostic = {
  code: string;
  phase: "environment" | "parse" | "lower" | "compile" | "link" | "bind" | "evaluate";
  message: string;
  source?: { uri: string; range: Utf16Range };
  bindingPath?: readonly (string | number)[];
  provenance?: Readonly<Record<string, string>>;
  cause?: Readonly<SyntaxOrCoreDiagnostic>;
};
```

Failure precedence is environment/provider normalization, parse, lower, core compile, link, the
per-binding pipeline above, then core evaluation. Declared dependency order breaks binding ties; no
later phase or binding runs after failure.
Sync capability rejection occurs in the phase where that capability would be used. Cancellation is
not reported as a competing language diagnostic.

Syntax, lower, compile, and evaluation diagnostics retain their lower-level code and identity as a
frozen `cause`. Canonical paths map through the prepared source map to the narrowest source range.
Environment and value failures have stable binding paths and sanitized provenance when no source
range exists. Diagnostics never expose runtime values, source text, provider objects, host exception
messages/stacks, secrets, or mutable causes.

## Provider and normalized-environment boundary

`@kalada/host` is the sole owner of provider, normalized-environment, compile/link, one-shot, and
prepared orchestration contracts. Providers and adapters are explicit, instance-scoped inputs and
are snapshotted during environment description. Importing a package performs no registration or
lookup side effect.

The normalized binding model keeps these authorities orthogonal:

- `KaladaSyntaxStaticType` (`"dynamic" | KaladaType`) alone controls lowering, operator dispatch, and
  core static semantics;
- recursive editor shape alone controls field enumeration, structural hover/completion, and seeded
  data generation;
- runtime validation and its sync/async mode are optional and do not infer either authority;
- transformation/codec is optional, explicit, directional, and distinct from validation;
- metadata is descriptive only; provenance records the provider, extractor, and explicit overrides.

Conceptually, a descriptor resembles:

```ts
type NormalizedBinding = Readonly<{
  id: string;
  path: readonly string[];
  semanticType: KaladaSyntaxStaticType;
  editorShape?: RecursiveEditorShape;
  validator?: { mode: "sync" | "async"; identity?: CapabilityIdentity; decode(value: unknown): unknown };
  codec?: { identity?: CapabilityIdentity; convert(value: unknown): unknown };
  metadata?: Readonly<Record<string, unknown>>;
  provenance: readonly ProvenanceEntry[];
}>;
```

The real contract uses safe results rather than trusting callbacks, and successful normalized data is deeply
immutable. Stable identity and ordered paths are preserved. Manual/native descriptors suffice for every host phase.
`dynamic` accepts an unknown semantic projection and defers checks to runtime, but operators requiring compile-time
domain selection can remain ambiguous and fail compilation. Unsupported known structure becomes `dynamic` only if
genuinely unknown; it is never silently widened to hide known unsupported structure, which stays visible or fails
under selected strictness.

## Schema capabilities and semantic preservation

An amended recursive `SchemaDocument` from external
[`spralle/scheman`](https://github.com/spralle/scheman) is the preferred general Scheman shape when
it becomes available. No release or tracker identifier is assumed here. Existing flattened Scheman
fields are compatibility input only and cannot be the authoritative recursive editor model. The
external recursive-structure work blocks only a rich Scheman adapter, not host/manual contracts,
Standard Schema validation, Standard JSON Schema/vendor shape extraction, or language foundations.
Scheman is always optional and importing `@kalada/host` must not load it.

Generic Standard Schema supplies runtime validation and static TypeScript input/output inference
only. It does not promise inspectable runtime structure. Recursive shape requires either a vendor
extractor or a Standard JSON Schema conversion. Standard Schema and Standard JSON Schema are
orthogonal capabilities and may describe the same binding. Supported JSON Schema shape preserves
objects, arrays, tuples, unions, requiredness, and reference provenance; unsupported or ambiguous
constructs remain visible as unknown or diagnostics rather than being flattened or guessed.

Optional properties do not silently become `Option`; nullable values do not silently become
`Option`; date/date-time strings do not silently become `Instant`; bigint does not silently become
number; and lossy unions do not silently become `json`. Validation output transformation likewise
does not choose a Kalada semantic type. `Option`, `Result`, `Instant`, `Duration`, and functions
require preserved Kalada extensions, explicit adapter configuration, or per-binding overrides.
Every conversion requires an explicit codec, validation of the converted Kalada value, and override
provenance. Bigint-to-number additionally requires an explicit safe-range policy and a value within
that range; otherwise it is rejected.

## Package topology

Dependency arrows point from importer to dependency:

```text
@kalada/syntax ----------> @kalada/core
@kalada/host ------------> @kalada/syntax, @kalada/core
@kalada/language-service -> @kalada/host, @kalada/syntax, @kalada/core
optional adapters -------> @kalada/host, optional vendor
apps/demo ---------------> @kalada/host, @kalada/language-service, selected adapters
```

The graph is acyclic. Host consumes public syntax/core APIs and does not duplicate their contracts.
Language service consumes host's immutable normalized-environment contracts but never invokes host
evaluation; host never imports language service. Vendor runtime/peer dependencies stay in isolated
optional packages or entry points. Direct low-level syntax and core APIs remain supported escape
hatches.

There is no `@kalada/sdk` now. An umbrella would add naming, version coordination, tree-shaking, and
dependency ambiguity before stable host and language-service usage exists. It may be reconsidered
only after those APIs stabilize and consumer evidence shows that one entry point improves
ergonomics without hiding optional dependencies or low-level APIs.

## Headless language service

`@kalada/language-service` manages URI-keyed, versioned virtual documents through explicit
open/update/close or equivalent immutable snapshot operations. Initial operations are `analyze`,
`diagnostics`, `completion`, `hover`, and `format`. Each request uses one document snapshot and each
response identifies its URI and version.

All public positions and ranges are zero-based UTF-16 line/character coordinates with half-open
ranges. Versioned line indexes convert internal offsets; clients never infer byte/code-point
offsets. Analysis combines syntax, lowering, core, and link information without changing
lower-level diagnostic identities. Recursive editor shape enumerates nested fields and supplies
structural hover; a known `KaladaType` in `KaladaSyntaxStaticType` filters operators and semantic
completion, while `dynamic` preserves ambiguity. Formatting returns version-targeted edits.

If a document version changes, results for an older version remain labeled stale and must not be
published as current; the service may return them only to the requesting snapshot. Cancellation is
cooperative at deterministic phase boundaries, produces no partial cache commit, and is distinct
from diagnostics. Scheduling, debounce, and final stale-result rejection are client-owned.

The service reserves a workspace/dependency-graph interface for #21 but defines no imports,
cross-file expression semantics, or module resolution now. It has no DOM, browser global,
CodeMirror, VS Code API, JSON-RPC/LSP transport, filesystem, or network dependency. CodeMirror and
future VS Code/LSP integrations are thin adapters for document events, UTF-16 coordinates,
diagnostics, edits, and cancellation; both share this service.

## Browser demo and schema workspace

`apps/demo` will be a bundler-first GitHub Pages browser IDE using CodeMirror 6 and an in-memory
virtual workspace. It owns `schema.json` and `data.json` plus multiple independent `.kalada` files.
All expression files share one normalized environment but cannot import or reference one another
until #21 defines modules.

For the supported JSON Schema subset, `properties` enumerates completion fields, `required` marks
presence without introducing `Option`, and `items`/tuple positions provide recursive element shape.
`$ref` resolves only within the schema or explicitly imported in-memory schema documents, with
bounded cycle/depth handling and visible unresolved-reference diagnostics; it never fetches a URL.
Union completion presents branch-qualified candidates and only treats a field/operator as common
when every viable branch supports it. Ambiguous or unsupported unions remain visible and do not
collapse to `json` for semantic dispatch.

Random data generation is deterministic and bounded. The same canonical recursive shape, explicit
seed, and generator-contract version produces the same candidate data. Generation observes
requiredness, arrays/tuples, references, and unions only within declared depth, node, collection,
and retry limits, then validates the candidate through the selected validator. Unsupported or
unsatisfiable constructs produce diagnostics or require user-supplied data; generated data is never
silently treated as valid.

Each expression file has debounced live preparation/evaluation keyed by document version and environment
generation. Completion publishes only while both remain current; evaluation also rejects stale data generations.
Independent files do not block one another. Panels show output/errors, diagnostics, inferred type, ordered
dependencies, and timing; inferred type requires the public syntax projection extension. Read-only advanced
inspectors expose lossless CST, canonical program, source map, normalized schema/environment, ordered dependencies,
link plan, and diagnostics through safe serialized snapshots.

Built-in samples may persist in origin-scoped browser storage with a versioned format, explicit
reset, and bounded explicit JSON import/export. Persistence is a convenience, not an execution or
trust boundary; imported content is treated as untrusted data and validated. The demo executes no
schema JavaScript or arbitrary code and uses no `eval`, `Function`, Node built-ins, ambient
filesystem, or ambient/network schema loading. It does not transmit source, schema, or data.

Assets, routing, workers if later added, and dynamic imports honor a configurable non-root Pages
base path and use no root-absolute assumptions. Content size, parser/evaluator limits, generation
bounds, and rendering escaping remain active for pasted or imported hostile input.

## Browser packaging policy

Vite or an equivalent bundler is the supported Pages path. The existing browser smoke baseline is
retained and expanded by follow-up work with a built non-root demo fixture. Passing it proves the
bundled browser path only. It does not prove direct CDN URLs or unbundled native import maps.

Native-ESM entry shape, coexistence with the core CJS wrapper, conditional exports, engine fields,
browser conditions, and packed direct-browser/CDN evidence require a separate policy gate before
any direct-CDN support claim. This ADR changes no package export or engine policy.

## Consequences, security, and compatibility

Prepared plans make repeated evaluation faster and give tooling reusable source/dependency indexes,
at the cost of explicit version/fingerprint compatibility and invalidation contracts. Capability
separation permits schema-library neutrality and a manual fallback, at the cost of visible gaps when
a schema supplies validation but no shape. One headless service permits editor reuse, at the cost of
strict URI/version, UTF-16, cancellation, and stale-result discipline.

Determinism comes from immutable snapshots, ordered dependencies, sequential validation, explicit
codecs, synchronous core execution, versioned seeded generation, and bounded work. Security comes
from data-only schema handling, no globals or dynamic code, safe diagnostics, explicit providers,
no network resolution, and existing core limits. These rules preserve existing syntax/core behavior
and direct APIs. They add orchestration contracts later; they do not reinterpret existing programs,
types, values, dependencies, diagnostics, package exports, or engine support.

## Follow-up delivery order

The proposed work items, recorded here without creating them, are:

1. **Bootstrap `@kalada/host` normalized descriptors and manual provider boundary.** Depends on this ADR.
2. **Add advanced compile/link artifacts and public one-shot/prepared sync execution.** Depends on item 1.
3. **Add explicit async validation host APIs and deterministic validator diagnostics.** Depends on item 2.
4. **Add Standard Schema plus Standard JSON Schema capability adapters.** Depends on item 1; execution integration
   depends on item 2.
5. **Add recursive Scheman adapter.** Depends on item 1 and external recursive `SchemaDocument` availability; it
   blocks no other foundation.
6. **Bootstrap headless `@kalada/language-service` document/diagnostic/formatting slice.** Depends on host normalized
   contracts and public syntax/core contracts.
7. **Add language-service completion/hover and thin CodeMirror adapter.** Depends on normalized host contracts,
   item 6, and a manual recursive-shape fixture; Standard-adapter integration/demo fixtures depend on item 4.
8. **Build `apps/demo` virtual workspace, seeded data, live evaluation, and inspectors.** Depends on items 2, 4, 7.
9. **Add non-root GitHub Pages deployment and browser bundle evidence.** Depends on item 8.
10. **Decide direct native-ESM/CDN, CJS-wrapper, and engine policy before any direct-CDN claim.** Independent after
    the bundled browser baseline; any support claim depends on this gate.

Host and language-service foundations may proceed after verification. Prefer vertical slices and independent
adapters. #21 blocks only module-aware workspace behavior; Scheman work blocks item 5; item 10 blocks CDN claims.

## Validation and Changeset policy

Implementation follow-ups require risk-based unit and integration fixtures for artifact
immutability/reentrancy, fingerprints, phase precedence, source mapping, dependency order, sync/async
separation, capability preservation, UTF-16/version/cancellation behavior, hostile schema/data, and
non-root browser packaging. Publishable package changes require impact-appropriate Changesets.
Demo-only, workflow-only, test-only, and documentation-only changes do not unless they also alter a
publishable package.

This ADR issue is validated with a frozen install, repository lint, typecheck, full tests and build,
`git diff --check`, and a docs-only changed-path check. It changes documentation only and has no
publishable runtime or package surface, so it has no Changeset.

## Explicit non-goals

This issue does not implement a package, adapter, language service, editor integration, app,
provider, cache, registry, validator, schema conversion, generator, deployment, or release. It does
not change canonical AST/evaluator semantics, create async core evaluation, or add effects/I/O,
modules/imports, or cross-file expression semantics.

There is no global registry, second parser/compiler/evaluator/type system, guaranteed shape from generic Standard
Schema, canonical recursive shape from flattened fields, implicit optional/nullable/date/bigint/union/ADT conversion,
mandatory Scheman dependency, framework-specific language service, VS Code extension, LSP transport, direct-CDN
claim, `@kalada/sdk`, publication work, or modification of release PR #63.

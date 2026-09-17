# ADR-0004: Deterministic projection v1

- Status: Accepted
- Date: 2026-09-17
- Decision sources: [Kalada #33](https://github.com/surikaterna/kalada/issues/33), parent
  [Kalada #7](https://github.com/surikaterna/kalada/issues/7), and
  [Formbar #93](https://github.com/surikaterna/formbar/issues/93)
- Runtime baseline: `@kalada/core@0.4.0`, release merge
  `f51df60aed35673cef50aaf5e79a627022a96830`
- Deferred module/import authority: [Kalada #21](https://github.com/surikaterna/kalada/issues/21)

## Context

Projection constructs JSON from canonical Kalada expressions without turning the core evaluator
into a template engine. SelectTransform is migration evidence, not a language specification: it
uses source expressions, interpolation, JavaScript truthiness, prototype mutation, implicit loops,
and composition features that are intentionally outside Kalada.

This ADR supersedes ADR-0001's deferred projection details only. It freezes a data contract before
the projection package and runtime exist. The executable fixture manifest and schema are
`tests/fixtures/projection-v1-contract.json` and `projection-v1.schema.json`; their JSON Lines case
files sit beside them. `core-0.4.0-compatibility.json` freezes the runtime baseline.

## Canonical contract

### Envelope and nodes

The exact envelope is:

```text
{ format: "kalada-projection", version: 1, profile: "projection-v1", root: ProjectionNode }
```

`ProjectionNode` is exactly one of these five closed, exact-key forms:

```text
value  { kind: "value", expression: KaladaV1Program<string> }
object { kind: "object", entries: [{ key: string, value: ProjectionNode }, ...] }
array  { kind: "array", items: [ProjectionNode, ...] }
if     { kind: "if", condition: KaladaV1Program<string>, then: ProjectionNode,
         else?: ProjectionNode }
map    { kind: "map", collection: KaladaV1Program<string>, item: string, index: string,
         body: ProjectionNode }
```

Every listed object rejects inherited, accessor, symbol, or extra properties. Arrays must be dense
own-data-property arrays. Canonicalization copies into recursively frozen arrays and null-prototype
objects. Field and array order is preserved; no field is sorted. A canonical input is idempotent.
Embedded programs use the public core canonicalizer with the default string reference codec only;
non-string references are invalid. Every string elsewhere is literal data. There is no source
expression or interpolation escape.

Object keys are non-empty strings. `__proto__`, `prototype`, and `constructor` are unsafe and
rejected. Duplicate keys are rejected by exact code-unit equality before any entry value is
canonicalized. Successful output objects have null prototypes and enumerable, non-writable,
non-configurable own properties in entry order; all output objects and arrays are recursively
frozen. There is no object merge behavior.

Map `item` and `index` are non-empty, distinct names. They are lexical projection bindings, not
host references. A nested map may shadow either name. Resolution always checks the innermost
projection binding, then each outer binding, before calling the host resolver. Item is the
canonical JSON element; index is its zero-based finite integer. These bindings are visible only to
the map body and its embedded programs, not to the map collection expression.

### Emission and omission

An evaluated `value` emits canonical JSON directly. `Option.some(json)` unwraps and emits its JSON
payload. `Option.none` produces the internal `omit` marker. `Result`, `Instant`, `Duration`, nested
or otherwise non-JSON ADTs, and evaluator-internal or host callables are rejected; no ADT is JSON
encoded implicitly.

`omit` has exactly these effects:

- at root, success is `{ ok: true, omitted: true }` with no `value` property;
- in an object, the current entry is absent;
- in an array, the current item contributes no slot;
- in a map, the current iteration contributes no slot;
- in a selected `if` branch, it propagates to the surrounding context.

An `if` without `else` whose condition is false also produces `omit`. Otherwise only the selected
branch is evaluated. The condition must be exactly the boolean `true` or `false`; no JSON or ADT
truthiness is accepted. Ordinary `null`, `false`, `0`, `""`, `[]`, and `{}` are emitted and never
cause omission. Arrays remain dense after omissions.

A missing host reference remains core `KALADA_REFERENCE_MISSING`. A resolver claiming `found` with
JavaScript `undefined`, a Promise, a callable, or any other invalid Kalada value remains a core
invalid-result diagnostic. Neither missing nor `undefined` means omission. Hosts express optional
output only with `Option.none`.

### Evaluation order

Traversal is depth-first and deterministic. Object entries and array items run left-to-right. An
object key is fixed before its value runs. `if` runs condition then only its selected branch. `map`
runs collection once, requires a dense canonical JSON array, then runs body for each element from
left to right; one iteration completes before the next starts. Empty input emits `[]`. Nested maps
follow lexical scope and this same order. No evaluation is parallel, speculative, flattening, or
merged.

The projection clock entry point samples its supplied clock exactly once, before the root is
evaluated, validates that sample using the core instant contract, and passes the same explicit
instant to every embedded evaluation. Clock failure precedes resolver calls and node traversal.
The explicit-input entry point samples no clock.

## Limits and accounting

All limits are inclusive positive safe integers. An omitted option uses the default. A value above
the hard maximum is rejected before canonicalization or evaluation. Equal-to-limit inputs pass;
the operation that would make a counter `limit + 1` fails without running that operation.

| Limit | Default | Hard maximum | Exact charge |
| --- | ---: | ---: | --- |
| `maxProjectionDepth` | 64 | 256 | root depth 0; each node edge adds one |
| `maxProjectionNodes` | 10,000 | 100,000 | each of the five nodes |
| `maxObjectEntries` | 10,000 | 100,000 | entries in each object node |
| `maxArrayItems` | 10,000 | 100,000 | items in each array node |
| `maxNameLength` | 128 | 1,024 | Unicode code points in each map binding name |
| `maxKeyLength` | 1,000 | 10,000 | Unicode code points in each object key |
| `maxExpressionInvocations` | 10,000 | 100,000 | each condition, collection, or value evaluation |
| `maxCollectionLength` | 10,000 | 100,000 | each map input before its first iteration |
| `maxCollectionIterations` | 10,000 | 100,000 | each started map body, cumulative per projection |
| `maxOutputDepth` | 64 | 256 | emitted root depth 0; each container edge adds one |
| `maxOutputNodes` | 10,000 | 100,000 | each emitted JSON value, including each container |
| `maxOutputBytes` | 1,048,576 | 16,777,216 | UTF-8 bytes of compact `JSON.stringify` output |

Projection canonicalization charges depth and nodes in canonical field order. Entry/item length is
checked at its array path before children. Key/name length is checked before duplicate/scope work.
Each embedded program is independently canonicalized under one complete set of caller-selected
core limits; projection counters do not replace core AST/value/string limits.

At runtime an expression invocation is reserved before core evaluation. Every invocation gets its
own fresh core evaluation counters and the same configured core limits, resolver, and sampled
instant. Projection invocation and iteration counters are cumulative across the whole projection.
Map length is checked before iteration; an iteration is reserved before its body. Omitted results
charge no output node or bytes.

Output nodes and depth are reserved as values are attached. A key's emitted value counts normally;
the key itself does not add a node. Bytes are checked after each complete root, object entry, array
item, or map item attachment by UTF-8 encoding that partial compact JSON. The final check includes
all punctuation and escaped key/string bytes. A failed attachment is not visible in the result.

## Diagnostics

A projection diagnostic is exactly `{ code, path, message, cause? }`. Stable codes are
`PROJECTION_INVALID_INPUT`, `PROJECTION_LIMIT_EXCEEDED`, `PROJECTION_DUPLICATE_KEY`,
`PROJECTION_UNSAFE_KEY`, `PROJECTION_CONDITION_TYPE`, `PROJECTION_COLLECTION_TYPE`,
`PROJECTION_VALUE_TYPE`, `PROJECTION_OUTPUT_LIMIT`, `PROJECTION_CORE_ERROR`, and
`PROJECTION_CLOCK_ERROR`. Messages are fixed generic text and never contain inspected values,
host exceptions, resolver details, stack traces, source text, or property-coercion output.

Paths start at `root` and use canonical fields, for example
`["root","entries",2,"value","expression"]`, `["root","items",1]`,
`["root","condition"]`, and `["root","body"]`. A map runtime body error appends the numeric
iteration index after `body`. An embedded failure has outer code `PROJECTION_CORE_ERROR`, points to
its `expression`, `condition`, or `collection` field, and has the exact frozen core diagnostic as
`cause`; core paths remain relative to the embedded program. Clock errors have no `cause`.

Canonical diagnostic precedence is: safe own-descriptor/exact-key reads; projection
depth/node/string limits; envelope or local shape; entry/item count; key/name bounds; unsafe key;
duplicate key or map-name collision; embedded core canonicalization; then the next canonical field.
Runtime precedence is clock sample; node entry; expression-invocation limit; embedded core result;
required projection type; map length; iteration reservation; selected child; output depth/nodes;
output bytes. Left-to-right traversal decides ties. No later branch, entry, item, or iteration runs
after failure.

Hostile getters and proxies fail as `PROJECTION_INVALID_INPUT` without forwarding thrown text.
Core resolver/clock failures retain only core's sanitized diagnostic in `cause`. Diagnostics and
all path/context/cause arrays and objects are recursively frozen.

## Migration and package boundary

The differential fixture classifies cases as `supported-equivalence`, `intentional-divergence`, or
`excluded-legacy`. It is migration evidence, not an executable SelectTransform dependency. Exact
substitution of supported JSON values is expressible through `value`; interpolation, source
expressions, truthiness omission, implicit loops, merge, flatten, include, template lookup, `let`,
and arbitrary JavaScript are not. Explicit nested `if` and `map` replace conditional chains and
ordered loops.

Future `@kalada/projection` depends one-way on public `@kalada/core/kalada-v1`; core never imports
projection. It must have no runtime dependency on SelectTransform and no prototype mutation,
ambient globals, hooks, dynamic code, or source parser. Modules/imports/hooks belong exclusively to
#21, and source syntax/parser/CST/formatter work to #8.

The gated delivery DAG is #33 (this ADR/fixtures) → #34 (package/contracts) → #35 (four non-map
nodes) → #36 (map/hardening) → #37 (packaging/release readiness). Only the immediate successor may
start after independent verification and merge. No projection release PR may merge before #37 is
verified; publication remains the reviewed trusted-OIDC workflow.

This issue adds documentation, fixtures, and contract tests only. It adds no package, runtime,
public API, or publishable change, so it has no Changeset.

## Explicit non-goals

Projection v1 does not execute arbitrary JavaScript, `Function`, source expressions, template
strings, or interpolation. It has no implicit truthiness, implicit loops, merge, flatten, include,
template registry, `let`, module, import, hook, effect, async evaluation, mutation, parser, syntax,
CST, formatter, or source map. It does not add a projection package or runtime in #33.

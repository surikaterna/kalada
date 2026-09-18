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

Object keys are non-empty strings. `__proto__`, `prototype`, `constructor`, and every canonical
ECMAScript array-index string are unsafe and rejected. An array-index string is exactly the decimal
`ToString(n)` for an integer `n` from 0 through 4,294,967,294: `"0"` or a non-zero digit followed
only by digits whose numeric value is at most 4,294,967,294. Thus `"00"`, `"01"`, `"-0"`, `"+0"`,
`"1.0"`, `"1e0"`, and `"4294967295"` are not array indexes and are accepted. This exclusion makes
ECMAScript own-key and compact-JSON order equal to entry order.

For each entry, key length is checked first, unsafe-key status second, and duplication by exact
code-unit equality third, all at `entryPath.concat(["key"])`; no value of a rejected entry is
canonicalized. Successful output objects have null prototypes and enumerable, non-writable,
non-configurable own properties in entry order. All output containers are recursively frozen.
There is no object merge behavior.

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
Map length is checked before iteration; an iteration is reserved before its body.

Output accounting is the compact `JSON.stringify` token stream in preorder, once per final output
occurrence. Identity is irrelevant: two output positions referencing the same immutable JSON value
are two occurrences. A value subtree is charged while emitted and is not charged again when its
parent attaches it. Root depth is zero; each object-property or array-element edge adds one. Every
primitive or container occurrence charges one node after its depth check. Object keys charge no
node.

Byte tokens are atomic UTF-8 sequences. A primitive charges UTF-8 `JSON.stringify(value)`. An
array charges `[`; then, in index order, `,` before every item after the first and that item's
tokens; then `]`. An object charges `{`; then, in entry order, `,` before every property after the
first, UTF-8 `JSON.stringify(key)`, `:`, and its value tokens; then `}`. Punctuation is one byte.
Strings and keys include their quotes and JSON escapes. Each token is reserved before emission and
the token that would exceed the inclusive byte limit fails.

Each root, object entry, array item, map iteration, and selected `if` branch has a transactional
checkpoint containing output counters and the first provisional output failure. Container tokens
known to survive are committed immediately. A prospective separator/key/colon and all child charges
are provisional until that child emits. Omission rolls back every provisional depth/node/byte
charge and pending output failure; emission commits without recharging; a non-output child failure
discards the transaction and wins. If a child emits, its earliest token-order output failure wins
and neither it nor later work is attached. Root omission rolls back all output charges and returns
exactly `{ ok: true, omitted: true }` with no `value` or diagnostic.

Output failure paths identify the token or occurrence. A constructed container uses its node path;
an object key/comma/colon uses its entry `key` path; an array separator uses its item path; and a map
separator uses `mapPath.concat(["body", iteration])`. A `value` result root uses its `expression`
path. Its nested JSON descendants append `"output"` and then their object keys or array indexes.
A map body inserts its zero-based iteration immediately after `body`; `if` adds no path segment.
Depth is checked before node count, then the occurrence's opening/primitive byte token, then child
tokens and its closing token. These rules define equal-limit success and the first `limit + 1`
failure without partial output.

## Diagnostics

A projection diagnostic is exactly `{ code, path, message, cause? }`; `cause` is present only for
`PROJECTION_CORE_ERROR`. The complete code/message/path contract is:

| Code | Exact message | Exact path |
| --- | --- | --- |
| `PROJECTION_INVALID_INPUT` | `Projection input is invalid.` | offending input field; malformed limit at `["limits", name]` |
| `PROJECTION_LIMIT_EXCEEDED` | `Projection limit exceeded.` | rejected limit option, node, key/name, entries/items array, expression invocation field, map collection, or `body,iteration` |
| `PROJECTION_DUPLICATE_KEY` | `Projection object key is duplicated.` | second entry's `key` |
| `PROJECTION_UNSAFE_KEY` | `Projection object key is unsafe.` | unsafe entry's `key` |
| `PROJECTION_CONDITION_TYPE` | `Projection condition must evaluate to a boolean.` | `if` node's `condition` |
| `PROJECTION_COLLECTION_TYPE` | `Projection map collection must evaluate to a JSON array.` | map node's `collection` |
| `PROJECTION_VALUE_TYPE` | `Projection value must evaluate to JSON, Option.some(JSON), or Option.none.` | value node's `expression` |
| `PROJECTION_OUTPUT_LIMIT` | `Projection output limit exceeded.` | output occurrence/token path defined above |
| `PROJECTION_CORE_ERROR` | `Kalada expression evaluation failed.` | failing `expression`, `condition`, or `collection` |
| `PROJECTION_CLOCK_ERROR` | `Projection clock failed.` | `["clock"]` |

Paths start at `root`. A map runtime body path inserts its numeric iteration after `body`. For input
shape, a failed safe descriptor read uses the property path being read; a proxy own-key/prototype
failure, extra string/symbol key, or wrong object prototype uses that object's path. Missing/wrong
`format`, `version`, `profile`, `root`, `kind`, or local field uses that field path. A wrong array
shape or extra array key uses the array field path; a hole/accessor uses its numeric index path.
Malformed limits (non-object map, unknown key, non-positive/non-safe value) use `[]`,
`["limits", unknown]`, or `["limits", name]` respectively. An override above its hard maximum is
`PROJECTION_LIMIT_EXCEEDED` at `["limits", name]`.

Projection depth/node failures use the node that would exceed; entry/item count uses its array;
key/name limits use their field; expression-invocation uses the expression field; collection length
uses `collection`; cumulative iteration uses `body,iteration`. Equal map names fail at `index`
because `item` is read first. Embedded compile/evaluation failure has the exact recursively frozen
core diagnostic as `cause`, whose path remains program-relative. No other code has `cause`. Every
diagnostic, path, context, and cause is recursively frozen.

Canonical precedence is: safe descriptors/own keys/prototype and exact keys; malformed limit
options; over-maximum options; projection depth then nodes; envelope/local shape; entries/items
count; key/name length; unsafe key; duplicate key or map-name collision; embedded core
canonicalization; next canonical field. Runtime precedence is: clock; node; invocation reservation;
core diagnostic; required projection type; map length; iteration reservation; selected child; then
the transactional output order above. Left-to-right order breaks ties. A non-output child diagnostic
wins over provisional output failure because omission/failure produces no occurrence. No later work
runs. Host exceptions, values, resolver details, stacks, source text, and property coercions never
enter messages or causes; hostile input is converted to the generic invalid-input diagnostic.

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

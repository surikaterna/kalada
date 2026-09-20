# ADR-0005: Deterministic navigation, operators, and control flow

- Status: Accepted
- Date: 2026-09-20
- Decision source: [Kalada #54](https://github.com/surikaterna/kalada/issues/54)
- Syntax authority: [Kalada #8](https://github.com/surikaterna/kalada/issues/8)
- Deferred modules and nominal ADTs: [Kalada #21](https://github.com/surikaterna/kalada/issues/21)
- Consumer context: [Formbar #61](https://github.com/surikaterna/formbar/issues/61),
  [#92](https://github.com/surikaterna/formbar/issues/92), and
  [#93](https://github.com/surikaterna/formbar/issues/93)
- Historical evidence only: [Kuery #33](https://github.com/surikaterna/kuery/issues/33),
  [#35](https://github.com/surikaterna/kuery/issues/35),
  [#36](https://github.com/surikaterna/kuery/issues/36), and
  [Arbitre #23](https://github.com/surikaterna/arbitre/issues/23)

## Context

Formbar needs deterministic navigation and ordinary expression operators before its declarative
language can consume Kalada. The canonical core currently has values, ADTs, temporal operations,
functions, and an iterative evaluator, but source tooling cannot safely invent operator semantics
or a competing expression tree. Historical Kuery and Arbitre behavior demonstrates demand and
migration cases; it is evidence, not a compatibility specification.

`kalada-v1` and `@kalada/core` are pre-stable but already published. A successor profile would
split one young language without protecting existing consumers. This ADR therefore expands
`kalada-v1` in place, while treating its new closed union variants as a real compatibility break
for strict decoders and exhaustive TypeScript consumers.

## Decision

### Canonical node families

The version-1 program envelope and profile name do not change. The expression union gains exactly
these closed, exact-key forms; every operator field is a closed enum, not an extensible string
operator registry.

```text
field-access          { kind, target, field: string }
optional-field-access { kind, target, field: string }
option-coalesce       { kind, option, fallback }
equality              { kind, operator: "equal" | "not-equal", left, right }
ordered-comparison    { kind, domain: "number" | "string",
                        operator: "less-than" | "less-than-or-equal" |
                                  "greater-than" | "greater-than-or-equal", left, right }
membership            { kind, needle, array }
numeric-binary        { kind, operator: "add" | "subtract" | "multiply" |
                                            "divide" | "remainder", left, right }
numeric-unary         { kind, operator: "plus" | "negate", operand }
boolean-not           { kind, operand }
boolean-logical       { kind, operator: "and" | "or", left, right }
boolean-xor           { kind, left, right }
conditional           { kind, condition, then, else }
```

Canonicalization retains the existing exact-own-data-property, recursive-freeze, AST depth/node,
string, and hostile-input rules. `field` may be any string, including an empty or
prototype-looking name, within `maxStringLength`; it is data and is never assigned to a host
prototype. Each new expression counts as one AST node, and children are canonicalized in the field
order shown above. Existing `temporal-arithmetic` and `temporal-comparison` forms and behavior are
unchanged. There is no generic `{ operator: string, arguments }` form.

### Field navigation

Strict access evaluates `target` once. It accepts only a canonical JSON object that is not an
array and reads only an enumerable own data field. It does not box primitives, traverse a
prototype, invoke a getter or method, or interpret a field as an array index. A missing own field
fails; a present field returns its value unchanged, including `null`, `false`, zero, and empty
values. A null, array, primitive, ADT, temporal value, or callable target is a type failure.

Optional access also evaluates `target` once and produces an Option. It unwraps at most one Option
layer before applying the following table:

| Evaluated target | Result |
| --- | --- |
| JSON object with own `field` | `Option.some(fieldValue)` |
| JSON object without own `field` | `Option.none` |
| `Option.some(JSON object)` | same field rule after one unwrap |
| `Option.none` | the same `Option.none` |
| `null` or `Option.some(null)` | `Option.some(null)` |
| primitive other than null, array, temporal, Result, callable, or nested Option | field-type diagnostic |

Terminal null deliberately propagates through a chain: applying another optional access to
`Option.some(null)` again yields `Option.some(null)`. A direct `Option.some(Option.some(...))` target
is invalid because only one layer is unwrapped. This distinction preserves missing, explicit null,
and present falsey data.

JavaScript `undefined` is not a Kalada value. It remains invalid at canonical value and resolver
boundaries and never means a missing field, `Option.none`, or null. Translating legacy Formbar
`undefined` is a separate host migration concern.

### Coalesce, equality, and membership

`option-coalesce` evaluates `option` first and requires an Option. `Option.some(value)` returns the
payload unchanged, including null, false, zero, empty string, empty array, or empty object, and
does not evaluate `fallback`. `Option.none` evaluates and returns `fallback`. It is a dedicated
canonical node: lowering creates no synthetic binding, match arm, capture, dependency, or extra
evaluation step.

Equality evaluates left then right and accepts every non-callable Kalada value. It performs no
coercion. Different value categories are unequal; in particular, number and string, JSON and ADT,
Instant and Duration, and different ADT types or variants are unequal. Finite numbers compare by
canonical numeric value (`-0` is already normalized), strings by exact UTF-16 code units, arrays
by ordered recursive elements, and JSON objects by exact own-key set and recursively equal values
regardless of key insertion order. Options and Results compare type, variant, and payload;
Instants and Durations compare type and milliseconds. A callable on either side is rejected rather
than compared by identity. `not-equal` is exactly the negation of successful `equal`.

Membership evaluates `needle` and then `array`. The right operand must be a canonical JSON array.
Elements are examined from index zero upward with the same deep canonical equality, and evaluation
returns at the first match. There is no object-key, string-substring, set, module, namespace, or
callable membership and no `nin` operator.

### Ordering, arithmetic, and static dispatch

Ordering accepts same-domain finite numbers, strings, Instants, or Durations only. Numeric and
string source forms lower to `ordered-comparison` with an explicit domain. Temporal source forms
lower to the existing `temporal-comparison` node. Strings compare lexicographically by UTF-16 code
units: the first unequal code unit decides, and an otherwise equal prefix is less than its longer
string. There is no locale, normalization, collation, or case folding.

Source lowering selects the domain from static operand information. One statically known operand
is sufficient when it selects exactly one of number, string, or temporal processing. Two
unconstrained dynamic operands are ambiguous and are rejected before canonical lowering. An
explicit canonical `ordered-comparison` is already domain-selected and permits dynamic operands,
which are checked against that domain at runtime.

The same rule selects `+` and `-`: number-selected forms lower to `numeric-binary`; valid temporal
forms lower to the existing `temporal-arithmetic` node. A known number selects numeric processing;
a known Instant or Duration selects temporal processing when the pair could satisfy an existing
temporal combination. Two unconstrained dynamic operands are ambiguous. `*`, `/`, `%`, and unary
`+` and `-` are always numeric and therefore need no cross-domain dispatch. Unsupported known
types are rejected statically, while a selected node validates dynamic values at runtime.

| Numeric operation | Contract |
| --- | --- |
| unary `plus` | finite operand, same numeric value, normalize `-0` |
| unary `negate` | finite negation, normalize `-0` |
| add/subtract/multiply | finite operands and finite result, normalize `-0` |
| divide | finite operands, reject `+0` or `-0` divisor, require finite result, normalize `-0` |
| remainder | finite operands, reject `+0` or `-0` divisor, require finite result, normalize `-0` |

Remainder is the IEEE-754 truncating remainder used for finite Numbers: its magnitude follows the
truncated quotient rule and its sign follows the dividend. It is not Euclidean modulo. All
non-finite inputs are invalid at the Kalada value boundary; an arithmetic operation that would
produce a non-finite value fails instead of returning it. Division and remainder check the zero
divisor before computing a result.

### Boolean and conditional semantics

`boolean-not` requires one boolean. `boolean-logical` requires a boolean left operand; `and`
returns false without evaluating right when left is false, while `or` returns true without
evaluating right when left is true. If needed, right is evaluated and must also be boolean.
`boolean-xor` evaluates both operands eagerly, left-to-right, requires two booleans, and is true
exactly when they differ. No operator uses truthiness, and `^` is not an XOR spelling.

`conditional` evaluates a strict boolean `condition` and exactly one runtime branch. Static type
analysis and dependency collection always visit `condition`, `then`, and `else` in that order.
Branch types join by the following complete rule:

| Branch types | Conditional type |
| --- | --- |
| structurally equal types | that type |
| unequal but both JSON-compatible | `json` |
| equal structural function types | that function type |
| either branch dynamic | dynamic |
| any other pair of known types | static operator-type diagnostic at `else` |

JSON-compatible means null, boolean, number, string, json, or arrays recursively containing JSON;
it excludes Option, Result, Instant, Duration, and functions. Equal Option, Result, temporal, array,
and function types are allowed by structural equality. No union type is synthesized.

### Source precedence and associativity

The syntax package must use this precedence, highest to lowest:

| Tier | Forms |
| ---: | --- |
| 1 | postfix call, `.`, `?.` |
| 2 | unary `!`, `+`, `-` |
| 3 | `*`, `/`, `%` |
| 4 | `+`, `-` |
| 5 | `<`, `<=`, `>`, `>=`, `in` |
| 6 | `==`, `!=` |
| 7 | `&&` |
| 8 | keyword `xor` |
| 9 | `||` |
| 10 | `??` |
| 11 | `? :` |

Postfix operations associate left, unary operations associate right, and binary tiers associate
left. Ternary associates right. Relational and membership forms are non-chainable: any second
tier-5 operator requires explicit parentheses. Even when precedence would otherwise decide it,
mixing `??` with `&&` or `||` in either direction is rejected unless parentheses make the grouping
explicit. Parentheses do not create canonical nodes.

## Type, dependency, and evaluator design

Field access has a dynamic result because version 1 has no structural object-field type. Optional
access produces `Option<dynamic>` unless a literal/null case gives a narrower payload. Coalesce
joins the Option payload and fallback by the conditional join rule. Equality, ordering,
membership, boolean nodes, and conditional conditions produce or require boolean as described;
numeric nodes produce number. Existing temporal result typing remains authoritative.

Dependencies are collected depth-first in canonical child order and retain first-seen
deduplication. Lazy behavior never removes static dependencies: logical right operands, coalesce
fallbacks, and both conditional branches contribute. Literal field names and closed operator
selectors are not references. No node creates lexical bindings.

Evaluation remains a loop over a current task/value and one bounded LIFO continuation stack; no
new node recursively evaluates a child on the JavaScript stack. The evaluator adds dedicated
frames with these phases and retained data:

| Frame | Phases | Retained data |
| --- | --- | --- |
| `field-access` | `target` | node path and field |
| `optional-field-access` | `target` | node path and field |
| `option-coalesce` | `option`, `fallback` | node path, fallback, outer environment |
| `equality` | `left`, `right` | node path, operator, right, left value |
| `ordered-comparison` | `left`, `right` | node path, domain, operator, right, left value |
| `membership` | `needle`, `array` | node path, array expression, needle value |
| `numeric-binary` | `left`, `right` | node path, operator, right, left value |
| `numeric-unary` | `operand` | node path and operator |
| `boolean-not` | `operand` | node path |
| `boolean-logical` | `left`, `right` | node path, operator, right |
| `boolean-xor` | `left`, `right` | node path, right, left boolean |
| `conditional` | `condition`, `branch` | node path, branches, outer environment |

Every frame is one live continuation for `maxContinuationFrames`; capacity is checked before its
first child starts. Phase changes retain the same frame. Child failure unwinds it and starts no
later child. Environments retained by lazy nodes ensure the selected child runs in the same lexical
scope as the parent.

The existing rule of one `maxEvaluationSteps` charge on entry to every evaluated expression stays
in force. These ordinary operator-frame deliveries add no resume charge. Skipped operands and
branches consume no runtime expression step. Deep equality uses an explicit bounded worklist, not
host recursion, and charges one evaluation step before each compared value pair. Membership reuses
that comparison cursor for each candidate from left to right; it starts and charges no later
candidate after a match or failure. A charge that would exceed the inclusive limit fails before
the comparison. Existing value depth/node limits bound the worklist, and all counters remain
evaluation-wide and are not refunded after short-circuiting.

## Diagnostics

The expansion adds these stable core categories and messages. “Node path” is the canonical path of
the operator expression beginning at `expression`.

| Code | Exact message | Narrow canonical path |
| --- | --- | --- |
| `KALADA_FIELD_MISSING` | `Kalada field does not exist.` | strict node's `field` |
| `KALADA_FIELD_TYPE_MISMATCH` | `Kalada field access requires a JSON object.` | node's `target` |
| `KALADA_OPTION_REQUIRED` | `Kalada option coalesce requires an Option value.` | coalesce node's `option` |
| `KALADA_OPERATOR_TYPE` | `Kalada operator received an incompatible value.` | first statically or dynamically invalid operand |
| `KALADA_OPERATOR_AMBIGUOUS` | `Kalada operator domain is ambiguous.` | node's `operator`, or the source operator range before lowering |
| `KALADA_NUMERIC_ZERO_DIVISOR` | `Kalada numeric divisor must not be zero.` | numeric node's `right` |
| `KALADA_NUMERIC_NON_FINITE` | `Kalada numeric operation produced a non-finite value.` | numeric node path for a non-finite result |

For `KALADA_OPERATOR_TYPE`, operand paths are `left`, `right`, `operand`, `needle`, `array`, or
`condition`; static conditional-join failure uses `else`. Callable equality reports the first
callable operand. Optional access uses `KALADA_FIELD_TYPE_MISMATCH` for a wrong primitive, array, ADT,
temporal, callable, or nested-Option target. Existing canonical-input, continuation, evaluation,
temporal, and function diagnostics retain their precedence and meanings.

Operands are evaluated left-to-right, so an earlier child diagnostic wins. After successful child
evaluation, type validation occurs before the next child starts. For division and remainder, right
type validation precedes zero-divisor validation; zero precedes result finiteness. Diagnostics and
contexts remain recursively frozen and contain no values, host exceptions, source text, or resolver
details.

## Compatibility and release policy

Previously valid `kalada-v1` programs retain their canonical form, static behavior, dependencies,
diagnostics, step accounting, and runtime results. The envelope remains `{ format:
"kalada-program", version: 1, profile: "kalada-v1", expression }`. Existing temporal nodes are not
rewritten into the new equality, ordering, or numeric families.

The expansion is nevertheless breaking: an old strict schema/decoder deterministically rejects a
new node as invalid input, and an exhaustive TypeScript consumer must add the new union members.
New encoders must not send these nodes to consumers that have not declared 0.6 compatibility.
Release notes must call this out as **BREAKING** and show the added variants and migration matrix.

All core stages ship together as `@kalada/core@0.6.0`; no release may expose a partial operator
subset. One coordinated minor Changeset covers the completed pre-stable breaking expansion. The
implementation sequence is strictly [#58](https://github.com/surikaterna/kalada/issues/58) →
[#56](https://github.com/surikaterna/kalada/issues/56) →
[#55](https://github.com/surikaterna/kalada/issues/55) →
[#57](https://github.com/surikaterna/kalada/issues/57) →
[#60](https://github.com/surikaterna/kalada/issues/60). Each successor waits for its predecessor's
independent verification. #60 owns parser/CST/lowering/formatting and the source restrictions above.
[Kalada #59](https://github.com/surikaterna/kalada/issues/59) remains dependent on #21 and does not
block this sequence.

The aggregate release gate includes `@kalada/projection`. Its published 0.1.0 manifest depends on
`@kalada/core@^0.5.0`, which excludes core 0.6.0, while its public contracts embed
`KaladaV1Program`. Core 0.6.0 must not be published alone while the supported projection package
remains incompatible. Before publication, #57's implementation/release integration updates the
projection runtime dependency to the 0.6 line, expected as `^0.6.0`, and coordinates publication of
the compatible core and projection packages. Existing projection programs and fixtures must retain
their outcomes. Projection accepts the expanded `kalada-v1` union only after it consumes core 0.6;
it must neither copy the expanded union nor claim support while resolving core 0.5.

The projection manifest change is publishable and requires its own appropriate Changeset. A patch
for `@kalada/projection` is expected when the change is backward-compatible packaging/integration
and projection runtime semantics are unchanged; any semantic change must use the bump justified by
its actual impact. #57 owns aggregate release readiness across all core slices and projection
compatibility. It must prevent any partial core-operator or core-only release.

Coordinated release evidence includes embedded-program conformance for old and new v1 nodes,
unchanged projection fixtures, projection build/tests and `projection:smoke`, strict and browser
consumers, packed core-plus-projection consumers, and an installation assertion that projection and
its host resolve one physical core instance so nominal Option, Result, Instant, Duration, and
callable brands retain identity. Packed manifests must show the intended 0.6 dependency and public
schemas/types must accept the same expanded program union.

Any failure before registry publication aborts the coordinated release and leaves core 0.5 with
projection 0.1 as the supported pair; no 0.6 compatibility or release claim is made. If registry
publication partially succeeds despite the gate, published artifacts are not overwritten or
silently treated as complete: release completion and support claims remain blocked, downstream
publication stops, and a reviewed forward-fix projection release must pass the full evidence set
before the aggregate release is announced. Existing artifacts are never reinterpreted as having
expanded-union support.

## Fixture and validation plan

Core implementation must add table fixtures for every canonical node, exact schema/codec
round-trip, extra/hostile-key rejection, static type selection, dependency order, canonical paths,
continuation limits, equal-step boundaries, and left-to-right failure precedence. Compatibility
fixtures must replay representative 0.5 programs unchanged and prove that a captured old strict
decoder rejects every new node family rather than misinterpreting it.

Semantic matrices must cover own/missing/prototype-looking fields; raw and one-layer Option
targets; terminal null chains; nested-Option rejection; coalesce payloads of null, false, zero, and
all empty JSON forms; equality across every value category; object key-order independence; ordered
UTF-16 edge cases; membership order; finite arithmetic boundaries, both signed zeros, overflow,
remainder signs, and negative-zero normalization; strict boolean failures; lazy resolver probes;
eager XOR; and every conditional type-join row. Deep equality and long membership fixtures must
exercise exact evaluation and continuation bounds without host-stack growth.

Formbar migration fixtures must distinguish missing, JavaScript `undefined`, null, false, zero,
empty string, empty array, and empty object. `undefined` must fail at the host boundary; no Kalada
fixture may canonicalize it. Syntax work adds precedence, associativity, prohibited mixing,
recovery, source-map, formatter-idempotence, and parse/format/reparse fixtures in #60.

Each implementation stage runs focused core tests plus repository lint, typecheck, full tests,
package smoke, changeset policy, packed-consumer checks, and `git diff --check`. The aggregate
release additionally verifies ESM, CJS, declarations, schema consumers, the projection/core gate
and identity evidence above, both package Changesets, and the explicit 0.6.0 BREAKING release note.

## Dependencies and non-goals

This ADR is the architecture gate for #58, #56, #55, #57, and #60. It does not implement runtime,
schema, parser, CST, formatter, source map, package, or release changes. Modules/imports and general
nominal enums/variants remain owned by #21/#59 and do not block Formbar's operator path.

There is no array indexing, computed property, optional call, method invocation, prototype access,
string concatenation, coercion, truthiness, exponentiation, BigInt, increment/decrement, bitwise or
shift operator, `nin`, loose equality, locale collation, union-type synthesis, arbitrary lazy hook,
open operator registry, ambient effect, or JavaScript compatibility layer. Arbitre scheduling,
effects, writes, clocks, and migration policy remain Arbitre-owned; Arbitre #23 supplies evidence
only.

This issue changes architecture documentation only, with no publishable package surface, so it has
no Changeset.

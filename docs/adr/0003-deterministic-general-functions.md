# ADR-0003: Deterministic typed general functions

- Status: Accepted
- Date: 2026-09-17
- Decision sources: [Kalada #22](https://github.com/surikaterna/kalada/issues/22),
  parent [Kalada #6](https://github.com/surikaterna/kalada/issues/6), and
  [Formbar #93](https://github.com/surikaterna/formbar/issues/93)
- Deferred module/import authority: [Kalada #21](https://github.com/surikaterna/kalada/issues/21)

## Context

ADR-0001 chose first-order, non-recursive functions and collection-only non-escaping lambdas.
The language instead needs one callable model that permits lexical closures, higher-order use,
and bounded recursion without exposing JavaScript functions or relying on the host stack. This
decision freezes that model before runtime work and freezes the released `@kalada/core@0.3.0`
compatibility baseline.

This ADR supersedes only ADR-0001's function boundary. Its package, canonical-AST, security,
effect, determinism, temporal, projection, extraction, and release decisions remain unchanged.

## Canonical contracts

### Types and expressions

Every function parameter and return has an explicit canonical Kalada type. Primitive types are
`null`, `boolean`, `number`, `string`, `json`, `Instant`, and `Duration`; constructors describe
`Option<T>`, `Result<T, E>`, `array<T>`, and functions. A function type is the exact ordered pair
`{ kind: "function-type", parameters: KaladaType[], returns: KaladaType }`. Function types are
structural and invariant: equal arity and recursively equal parameter and return types are
required. There are no implicit conversions, overloads, optional/rest parameters, generics, or
inferred public signatures.

The canonical AST adds these data-only forms:

```text
function     { kind, parameters: [{ name, type }], returns, body }
call         { kind, callee, arguments: [expression...] }
function-group {
  kind,
  functions: [{ name, parameters: [{ name, type }], returns, body }],
  body
}
core-function { kind, name: "map" | "filter" | "some" | "every" }
```

Arrays and declaration order are semantic and are never sorted. Names are non-empty bounded
strings. A function expression evaluates to an immutable user closure. A group creates all
named closures simultaneously and then evaluates `body`; every group name is visible in every
member body, supporting direct and mutual recursion, but not in parameter/type declarations or
outside the group. Duplicate group or parameter names are invalid. A parameter shadows a group
name, and an inner lexical binding shadows parameters, group members, and outer bindings.

These are canonical AST contracts, not source syntax. Parser, CST, formatter, lowering, and
source spelling remain deferred to #8.

### Lexical closures and callable boundary

A closure contains its canonical function identity, immutable definition-scope environment,
and statically determined ordered captures. Capture is lexical: a call never reads bindings
from its caller's local environment. Captured names are the free references resolved to an
enclosing lexical binding, ordered by first occurrence in depth-first, field-order and
left-to-right array traversal. Parameters, local bindings, and recursive-group names are not
capture slots. Group members share an internal immutable recursive environment; recursive edges
do not multiply capture counts. Shadowing is resolved before capture ordering.

Unbound references remain external dependencies and use the evaluation's original resolver;
they are not dynamic caller scope. Dependency collection traverses every declaration body and
the group body in canonical order, excludes lexical parameters, locals, captures, and group
names, and emits external references in first-seen order using the existing canonical reference
identity. A function that is never called still contributes static dependencies.

User closures and core-function values may be bound, passed, returned by a function, captured,
and called immediately while an evaluation is in progress. They are evaluator-internal
callables, not `KaladaValue`: resolvers cannot provide them; literals, value schemas, codecs,
equality, ADTs, JSON, and ordinary collection elements cannot contain them. A callable reaching
the top-level evaluation result fails with `KALADA_FUNCTION_ESCAPE`. Encoding or externally
validating one fails as an invalid value. There is no host-function adapter or spoofable public
callable object.

## Evaluation

### Common dispatch and order

There is one callable dispatcher for user closures and the four core functions. For a call,
evaluation enters the call node, evaluates the callee, checks callability and arity, evaluates
arguments left-to-right, checks each argument immediately against its corresponding type, then
checks call and continuation limits and dispatches. A failure stops all later work. User bodies
run in the captured definition environment extended with the complete recursive group and then
parameters in declaration order. The returned value is checked against the declared return type
before the caller resumes.

Evaluation uses an explicit iterative continuation/trampoline. Entering a user or core call
never invokes the evaluator recursively on the JavaScript stack. Direct, mutual, callback, and
non-tail recursion use the same mechanism. No tail-call-elimination guarantee changes the
observable call-depth charge.

Function-group construction is left-to-right. It validates the whole group before materializing
any closure, snapshots captures from definition scope, creates all group members atomically,
then enters `body`. A closure creation or limit failure prevents body evaluation.

### Core collection functions

`map`, `filter`, `some`, and `every` are canonical core-function values, not special callback
syntax. Their signatures require a JSON array and a callback receiving exactly `(element,
index)`, where index is the zero-based finite integer. They accept only dense canonical JSON
arrays. Callbacks for `map` return JSON, while callbacks for `filter`, `some`, and `every` return
boolean. `map` and `filter` produce new frozen JSON arrays in input order; `some` and `every`
produce booleans. Thus no callable can enter an input array or collection result.

Elements are visited from index zero upward. Each callback fully completes before the next
index. `some` stops after the first `true`; `every` stops after the first `false`; skipped
elements incur no callback, step, call, value, or continuation charge. Empty results are:
`map = []`, `filter = []`, `some = false`, and `every = true`.

## Validation, limits, and accounting

All limits are inclusive positive safe integers. Omitted values use the default; overrides above
the hard maximum are rejected before canonicalization or evaluation.

| Limit | Default | Hard maximum | Charge |
| --- | ---: | ---: | --- |
| `maxFunctionParameters` | 32 | 256 | each declared parameter |
| `maxFunctionGroupSize` | 64 | 1,024 | each declaration in one group |
| `maxCapturesPerClosure` | 64 | 256 | each distinct lexical capture slot |
| `maxCapturedBindings` | 1,000 | 100,000 | each slot materialized across one evaluation |
| `maxClosures` | 1,000 | 100,000 | each user closure materialized |
| `maxCallDepth` | 256 | 4,096 | each active user or core dispatch |
| `maxContinuationFrames` | 1,000 | 100,000 | each live trampoline frame |
| `maxCollectionLength` | 10,000 | 100,000 | input length before iteration |
| `maxEvaluationSteps` | 10,000 | 100,000 | existing shared operation budget |

Function nodes, calls, core-function nodes, group declarations, parameters, and type nodes each
count once toward existing AST-node/depth limits. A type's children are traversed in parameter
then return order. Closure environments and group back-edges do not count as `KaladaValue` nodes
and are never recursively walked as values.

The existing rule of one step on entry to every evaluated expression remains. In addition, the
dispatcher charges one step when dispatch begins, the trampoline charges one step when it
resumes a suspended frame, closure materialization charges one step per closure, capture copy
charges one step per slot, and a collection core function charges one step per visited element
before its callback. Arity and non-callable failures occur before dispatch charging; argument
expressions retain their ordinary node charges. Limit checks happen before the operation that
would exceed the inclusive bound. Counters are evaluation-wide and are not refunded after
return or short-circuit; active call depth and live continuation frames decrement on return.

Static validation precedence is: safe structural read and exact keys; AST/depth/string limits;
node discriminant and local field shape; duplicate declarations/parameters; type shape; lexical
resolution and capture analysis; function/group/capture limits; dependency extraction. Runtime
precedence is: call node step; callee result; callability; arity; arguments left-to-right with
immediate type checks; call depth; continuation capacity; dispatch step; body or collection
work; return type; top-level escape. The shared evaluation-step failure wins whenever its next
charge occurs earlier in this sequence.

## Diagnostics and context

Function work adds stable codes: `KALADA_DUPLICATE_BINDING`, `KALADA_INVALID_FUNCTION_TYPE`,
`KALADA_CAPTURE_LIMIT`, `KALADA_NOT_CALLABLE`, `KALADA_FUNCTION_ARITY`,
`KALADA_FUNCTION_TYPE_MISMATCH`, `KALADA_CLOSURE_LIMIT`, `KALADA_CALL_DEPTH_LIMIT`,
`KALADA_CONTINUATION_LIMIT`, `KALADA_COLLECTION_TYPE_MISMATCH`,
`KALADA_COLLECTION_LIMIT`, and `KALADA_FUNCTION_ESCAPE`. Existing structural and step-limit
codes retain their meanings.

The diagnostic `path` identifies the canonical field whose validation or evaluation failed.
Runtime diagnostics additionally carry a frozen `context` array, innermost first, of at most 32
frames. A frame is exactly `{ kind: "function-call" | "core-call", name: string | null, path }`.
Truncation keeps the innermost frames and is deterministic. Static diagnostics and failures
outside a call use an empty context. Messages remain stable, generic, and contain no host error,
captured value, resolver detail, or source-syntax text.

## Compatibility baseline and delivery gates

The fixtures in `tests/fixtures/core-0.3.0-compatibility.json` were captured from the npm artifact
with SHA-1 `c963824e9e5470d461b10cfae944d1b1378a29c2` and SHA-512 integrity
`sha512-viBoDxOSef4qYV3sHh3ik67tfssKMdChpFrUvOOzuDui+itTELqwmZ7zae9ajJXaNUaaUnAtiNeOwRBaoJnyGw==`.
They freeze root and `kuery-v1` ESM/CJS exports and declarations, package identity/exports and
zero runtime dependencies, plus canonicalization, dependencies, diagnostics, ADTs, temporal
values, schemas, limits, and representative outcomes. Root and `kuery-v1` permit no drift;
general-function work is additive only under `kalada-v1`.

Delivery follows #22 (this ADR/baseline) → #23 (contracts/captures) → #24
(closures/recursion/trampoline) → #25 (collection functions) → #26 (hardening/package/minor
Changeset). A successor starts only after its predecessor is verified. This issue changes no
runtime or publishable API and therefore has no Changeset.

## Non-goals

This decision does not implement runtime behavior. It adds no modules, imports, module resolver,
manifest, hook, native intrinsic, capability, effect, mutation, async behavior, host function,
parser syntax, CST, formatter rule, or additional collection function. Modules and imports are
exclusively deferred to #21; source syntax remains separately deferred to #8.

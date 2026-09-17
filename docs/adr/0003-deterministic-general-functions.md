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

There is one callable dispatcher for user closures and the four core functions. The continuation
machine below is the sole runtime-order authority; later accounting text only identifies which
of its transitions charge. Evaluation has one current state (`evaluate` an expression or
`deliver` a value), one current lexical environment, and one LIFO stack. Evaluator code never
recursively evaluates a child, and there is no hidden administrative stack. Direct, mutual,
callback, and non-tail recursion therefore never grow the JavaScript stack.

Each frame has only the listed phases and payload. Paths and expression arrays are canonical;
environments and partial values are evaluator-internal immutable snapshots.

| Frame | Closed phases | Exact retained payload | Capacity-failure path |
| --- | --- | --- | --- |
| `binding` | `value`, `body` | node path, name, body, outer environment | child `value` |
| `constructor` | `payload` | node path, ADT type and variant | child `value` |
| `match` | `scrutinee`, `arm` | node path, declared type, arms, outer environment, scrutinee or null, selected arm index or null | child `value` |
| `temporal-binary` | `left`, `right` | node path, arithmetic/comparison kind, operator, right expression, left value or null | child `left` |
| `function-group-body` | `body` | node path, body, outer environment, group environment | group `body` |
| `call-callee` | `callee` | call path, argument expressions | call `callee` |
| `call-arguments` | `argument` | call path, callable, argument expressions, completed values, current index | call `arguments` array |
| `user-return` | `body` | call path, callable name or null, declared return type, caller environment | call node; core callback uses callback expression `arguments[1]` |
| `core-iteration` | `ready`, `callback` | call path, operator, callback, input array, next index, partial result | call node |

Every listed frame counts as one live frame toward `maxContinuationFrames`. A push is allowed
exactly when the resulting count is at most the configured limit; otherwise
`KALADA_CONTINUATION_LIMIT` occurs at the table path before the child or dispatch starts. A phase
change retains the same frame and needs no capacity check. Pop and unwind discard the complete
payload. A future child-evaluating node is invalid until this table and the delivery table define
its frame. Literals, references, `Option.none`, instants, durations, current-instant, function
expressions, and core-function expressions require none.

The following table is the complete successful-delivery transition function. “Charge” occurs
while the frame is live and before validation, mutation, or pop.

| Frame.phase receiving a value | Charge | Canonical transition |
| --- | ---: | --- |
| `binding.value` | 0 | Store no initializer in the frame; switch to `body`, extend the current environment with `(name, value)`, evaluate retained body. |
| `binding.body` | 0 | Pop, restore outer environment, deliver value. |
| `constructor.payload` | 0 | Pop, construct retained ADT type/variant with value, deliver result. |
| `match.scrutinee` | 0 | Validate declared ADT type, store scrutinee and selected canonical arm index, switch to `arm`, extend the environment only for that arm's payload binding, evaluate its body. |
| `match.arm` | 0 | Pop, restore outer environment, deliver value. |
| `temporal-binary.left` | 0 | Validate left operand, store it, switch to `right`, evaluate retained right expression. |
| `temporal-binary.right` | 0 | Validate right operand, pop, apply retained typed operator to stored left and delivered right, deliver result. |
| `function-group-body.body` | 0 | Pop, restore outer environment, deliver value. |
| `call-callee.callee` | 1 | Pop, check callability and arity; dispatch immediately if arguments are empty, otherwise capacity-check/push `call-arguments` at index zero and evaluate argument zero. |
| `call-arguments.argument` | 1 | Immediately type-check and append value; if another argument exists, increment index and evaluate it with this frame retained; otherwise pop and dispatch. |
| `user-return.body` | 1 | Pop, restore caller environment, decrement active call depth, validate return type, deliver value. |
| `core-iteration.callback` | 1 | Validate callback result; update partial result, then either short-circuit/finish by pop, depth decrement, and result delivery, or increment index, retain frame, charge next visited element, and dispatch its callback. |

Entering `binding`, `constructor`, `match`, or `temporal-binary` first charges its existing AST
node, then capacity-checks/pushes its first phase, then evaluates the first child. Parent frames
remain live below every nested frame. Function-group entry charges its node, validates the whole
group, snapshots captures, creates members left-to-right, then capacity-checks/pushes
`function-group-body` and evaluates body in the group environment. Pre-push failure starts no
child; closure/capture failure starts no group body.

Call entry charges its node, capacity-checks/pushes `call-callee`, then evaluates the callee. The
callee delivery transition above is conditional: zero arguments create no `call-arguments`
frame; one argument creates one frame for one delivery; two or more create the same single frame
and retain it sequentially. Thus argument count never creates simultaneous argument frames. At a
top-level call with leaf callee/arguments, a continuation limit of one permits each sequential
stage; a nested child needing its own frame while a parent is retained requires two, and another
nested suspension requires three. The limit measures maximum simultaneous occupancy, not total
pushes.

User dispatch first checks call depth, then continuation capacity, then charges one dispatcher
step, increments depth, pushes `user-return`, and evaluates the body in the closure's captured
definition environment extended by its recursive group and parameters. Core dispatch follows
the collection-length gate below, then the same depth/capacity/dispatcher order, increments
depth, and pushes `core-iteration.ready`. Empty input immediately pops, decrements depth, and
delivers the operator's empty result with no delivery charge. Non-empty input changes the same
frame to `callback`, charges one visited-element step, and dispatches the callback with already
evaluated `(element, index)` values; these values create no argument frame.

Any child diagnostic performs no successful-delivery charge. It unwinds all live frames,
discarding every payload and partial result, restoring each saved environment, and decrementing
each active user/core call depth exactly once. No later child or collection element runs. A
delivery with no frame is the top-level result. Tail calls receive no occupancy or charging
exception.

### Core collection functions

`map`, `filter`, `some`, and `every` are canonical core-function values, not special callback
syntax. Their signatures require a JSON array and a callback receiving exactly `(element,
index)`, where index is the zero-based finite integer. They accept only dense canonical JSON
arrays. Callbacks for `map` return JSON, while callbacks for `filter`, `some`, and `every` return
boolean. `map` and `filter` produce new frozen JSON arrays in input order; `some` and `every`
produce booleans. Thus no callable can enter an input array or collection result.

The collection-length gate runs after both call arguments have been evaluated, immediately
type-checked, appended, and the `call-arguments` frame has popped, but before core call-depth or
continuation-capacity checks, dispatcher charge, depth increment, or `core-iteration` push. An
input length equal to `maxCollectionLength` passes. A larger input fails with
`KALADA_COLLECTION_LIMIT` at the exact path `callPath.concat(["arguments", 0])`, where
`callPath` denotes the call node's canonical path segments. The diagnostic context contains only
already-active outer calls, innermost first; at top level it is empty, and the rejected core call
adds no `core-call` frame. The gate itself charges no step, call, continuation, callback, result,
or value operation. On failure there is no core depth/frame to undo; ordinary diagnostic
propagation unwinds any outer frames under the machine rule above. A non-array fails immediate
argument type validation first and never reaches this gate.

Elements are visited from index zero upward. Each callback fully completes before the next
index. `some` stops after the first `true`; `every` stops after the first `false`; skipped
elements incur no callback, step, call, value, or continuation charge. Empty results are:
`map = []`, `filter = []`, `some = false`, and `every = true`.

## Validation, limits, and accounting

All limits are inclusive positive safe integers. Omitted values use the default; overrides above
the hard maximum are rejected before canonicalization or evaluation.

| Limit | Default | Hard maximum | Charge |
| --- | ---: | ---: | --- |
| `maxFunctionParameters` | 32 | 256 | each user-declared function/type signature independently |
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

`maxFunctionParameters` resets for every function expression, every member of a function group,
and every function type, including a nested callback type. It is neither cumulative across a
group/program nor evaluation-wide. The trusted intrinsic signatures of `map`, `filter`, `some`,
and `every` are fixed language contracts outside this configurable limit: a `core-function` node
has no synthetic parameters array, does not consume the allowance, and cannot fail this limit.
The callback's actual user-function declaration and any explicit callback function type remain
subject to the limit at their own canonical `parameters` paths. Consequently an override of one
accepts the intrinsic node but rejects a two-parameter callback declaration before evaluation;
the required `(element, index)` callback is available only when its declared signature is
permitted. A parameters array of exactly the configured limit is accepted; the next element is
rejected with `KALADA_LIMIT_EXCEEDED` at the canonical `...parameters` array path. After safe
descriptor/exact-key reads and enclosing AST/depth/string checks, parameter-array shape and
length are checked before reading parameter entries, duplicate names, or parameter/return types.
This per-signature check therefore precedes duplicate-binding, type-shape, capture, and
dependency diagnostics for that signature.

The existing rule of one step on entry to every evaluated expression remains. In addition, the
dispatcher charges one step when dispatch begins; only `call-callee`, `call-arguments`,
`user-return`, and `core-iteration` successful deliveries charge the table's resume step;
closure materialization charges one step per closure; capture copy charges one step per slot;
and a collection core function charges one step per visited element before its callback. The
four legacy administrative frames and `function-group-body` deliver without a resume charge,
preserving exact 0.3.0 step outcomes. Arity and
non-callable failures occur after the charged `call-callee` delivery but before argument or
dispatch charging. Argument expressions retain their ordinary node charges. Limit checks happen
before the operation that would exceed the inclusive bound. Counters are evaluation-wide and
are not refunded after return or short-circuit; active call depth and live continuation frames
decrement on return or failure unwind.

Static validation precedence is: safe structural read and exact keys; AST/depth/string limits;
node discriminant and local field shape; per-signature parameter length; duplicate declarations
or parameters; type shape; lexical resolution and capture analysis; group/capture limits;
dependency extraction. Runtime precedence is exclusively the transition order in the canonical
machine and frame table above; this sentence introduces no second summary order. The shared
evaluation-step failure wins exactly at the next charged node, dispatch, materialization, copy,
visited element, or charged delivery in that machine.

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

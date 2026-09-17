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

The trampoline has one current state (evaluate an expression or deliver a completed value) and
one LIFO continuation stack. It uses exactly four function-related frame variants:

- `call-callee` retains the call path and argument expressions while the callee evaluates.
- `call-arguments` retains the callable, one next-argument index, and completed argument values.
  One frame serves the entire argument list; there is never one frame per remaining argument.
- `user-return` or `core-iteration` retains one active dispatch. `user-return` retains the
  declared return type and call path. `core-iteration` retains the operator, callback, input,
  next index, and partial result or short-circuit state.

Entering a call node first charges its ordinary expression step, checks continuation capacity,
pushes one `call-callee` frame, and evaluates the callee. Successful callee delivery resumes and
charges that frame, pops it, then checks callability and arity. A zero-argument call proceeds to
dispatch. Otherwise the machine checks capacity, pushes one `call-arguments` frame, and
evaluates argument zero. Each successfully delivered argument resumes and charges the same
retained frame, is type-checked and appended, then either starts the next argument without
another push or pops the frame after the last argument. Child failure unwinds retained frames
without a resume charge and evaluates no later argument.

After arguments, user dispatch checks call depth and capacity, charges the dispatcher step,
increments active call depth, pushes one `user-return` frame, and evaluates the body. Successful
body delivery resumes and charges that frame, pops it, decrements call depth, validates the
declared return type, then delivers to the next frame. Return-type failure occurs after the pop
and decrement. A body failure unwinds the frame and decrements depth without a resume charge.
The caller's frame remains below `user-return` throughout. This transition, rather than a
JavaScript evaluator call, is the only way to enter a user body.

Core dispatch performs the same call-depth/capacity checks and dispatcher charge, increments
depth, and pushes exactly one `core-iteration` frame. Empty input pops it immediately, decrements
depth, and delivers the operator's empty result without a resume charge because no child ran.
For a visited element the retained frame first charges the element step, then invokes the
callback through common dispatch with the already evaluated `(element, index)` values; callback
values create no argument-expression frame. Successful callback delivery resumes and charges
`core-iteration`, validates the operator-specific result, and either retains the same frame for
the next index or pops it, decrements depth, and delivers the completed/short-circuit result.
`some(true)` and `every(false)` pop immediately after that callback resume. Callback failure
unwinds the core frame, decrements depth, and performs no resume, later-element, or result charge.

A push is allowed exactly when the resulting live-frame count is at most
`maxContinuationFrames`; otherwise it fails before the child or dispatch starts. A resume means
delivery of one successful child value to the current top frame and charges one evaluation step
while that frame is still live. Pop, unwind, initial frame setup, switching a retained argument
or iteration frame to its next child, and delivery with no frame do not charge a resume step.
Consequently stack occupancy and step boundaries depend only on these transitions, not on an
implementation's loop structure or JavaScript call stack.

Continuation-capacity failure uses `KALADA_CONTINUATION_LIMIT`. A `call-callee`, `user-return`,
or `core-iteration` push reports the canonical call-node path; `call-arguments` reports that
call's `arguments` array path. Dispatching a core callback from already evaluated values reports
the callback expression path (`arguments[1]`) for its return-frame capacity failure. These paths
are fixed even though no source-syntax call exists for the callback invocation.

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
| `maxFunctionParameters` | 32 | 256 | length of each function/callback signature independently |
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
group/program nor evaluation-wide. Built-in core signatures obey the same bound but do not
consume a user declaration's allowance. A parameters array of exactly the configured limit is
accepted; the next element is rejected with `KALADA_LIMIT_EXCEEDED` at the canonical
`...parameters` array path. After safe descriptor/exact-key reads and enclosing AST/depth/string
checks, parameter-array shape and length are checked before reading parameter entries, duplicate
names, or parameter/return types. This per-signature check therefore precedes duplicate-binding,
type-shape, capture, and dependency diagnostics for that signature.

The existing rule of one step on entry to every evaluated expression remains. In addition, the
dispatcher charges one step when dispatch begins, each successful frame resume defined above
charges one step, closure materialization charges one step per closure, capture copy charges one
step per slot, and a collection core function charges one step per visited element before its
callback. Arity and non-callable failures occur after the charged `call-callee` resume but before
argument or dispatch charging. Argument expressions retain their ordinary node charges. Limit
checks happen before the operation that would exceed the inclusive bound. Counters are
evaluation-wide and are not refunded after return or short-circuit; active call depth and live
continuation frames decrement on return or failure unwind.

Static validation precedence is: safe structural read and exact keys; AST/depth/string limits;
node discriminant and local field shape; per-signature parameter length; duplicate declarations
or parameters; type shape; lexical resolution and capture analysis; group/capture limits;
dependency extraction. Runtime precedence is: call-node step; `call-callee` capacity/push;
callee result; callee-frame resume step; callability; arity; argument-frame capacity/push;
arguments left-to-right with a resume step and immediate type check after each; call depth;
return/iteration-frame capacity; dispatch step; body or collection work and their frame resumes;
return type; top-level escape. The shared evaluation-step failure wins whenever its next charge
occurs earlier in this sequence.

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

# `@kalada/core`

This dependency-free package owns Kalada's canonical, versioned runtime contracts. The root
exports the four-field `KaladaProgramV1` envelope, its strict canonicalizer, and Kuery-expression
adapters. It intentionally does not export a compiler, evaluator, profile, parser, effects, or
scheduling semantics.

The exact Kuery 2.1 strict-expression compatibility API is available only from
`@kalada/core/kuery-v1`. Provenance is recorded in the shipped `provenance/kuery-2.1.0.json`, and
third-party license declarations are reproduced in `THIRD_PARTY_NOTICES.md`.

## Native `kalada-v1` profile

`@kalada/core/kalada-v1` is an additive, dependency-free native profile. It provides private
WeakSet-branded `Option`/`Result` runtime values, explicit `kalada-value` v1 encoding, canonical
program constructors and schemas, static function analysis, and a bounded compiler/evaluator.
Typed functions are lexical values: they may capture bindings, be passed or returned, and call
themselves or members of the same function group. Evaluation uses an iterative continuation
machine, so recursion is bounded by configured limits rather than the JavaScript call stack.

JSON values remain opaque. Only `decodeKaladaValue` decodes an encoded envelope, and every JSON
value is wrapped in a `Json` envelope so a discriminant-shaped object round-trips as ordinary JSON.
Callable values are evaluation-internal and cannot escape through a top-level result, an ADT, JSON,
or the value codec.

```ts
import { KaladaV1, compileKaladaV1Program } from "@kalada/core/kalada-v1";

const expression = KaladaV1.match("Option", KaladaV1.Option.some(KaladaV1.literal("Ada")), [
  KaladaV1.arm("some", KaladaV1.ref("name"), "name"),
  KaladaV1.arm("none", KaladaV1.literal("unknown")),
]);
const compiled = compileKaladaV1Program(KaladaV1.program(expression));
const value = compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
```

### Functions and collections

Function parameters and returns use `KaladaV1.Type`. Calls validate arity and runtime values, and
arguments are evaluated left-to-right. The collection functions are first-class callable values;
callbacks receive `(element, zeroBasedIndex)`, preserve input order, and `some`/`every`
short-circuit.

```ts
import { KaladaV1, compileKaladaV1Program } from "@kalada/core/kalada-v1";

const json = KaladaV1.Type.primitive("json");
const number = KaladaV1.Type.primitive("number");
const indices = KaladaV1.call(KaladaV1.coreFunction("map"), [
  KaladaV1.literal(["a", "b", "c"]),
  KaladaV1.function(
    [KaladaV1.parameter("element", json), KaladaV1.parameter("index", number)],
    json,
    KaladaV1.ref("index"),
  ),
]);
const compiled = compileKaladaV1Program(KaladaV1.program(indices));
const outcome = compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
// outcome: { ok: true, value: [0, 1, 2] }
```

Named members of `KaladaV1.functionGroup` support direct and mutual recursion. Closures capture the
definition scope, not the call scope. `analyzeKaladaV1Functions` exposes frozen capture metadata;
`compileKaladaV1Program` also includes it in the compiled program's `functions` field.

### Limits and failures

`compileKaladaV1Program(program, { limits })` accepts partial overrides for AST/value/string,
evaluation-step, function-parameter/group, capture, closure, call-depth, continuation, collection
length, and cumulative collection-iteration limits. Defaults are exported as
`DEFAULT_KALADA_V1_LIMITS` and `DEFAULT_KALADA_V1_FUNCTION_LIMITS`. Limits are inclusive and a
failure returns a frozen diagnostic instead of throwing. Nested call diagnostics include at most
the 32 innermost frozen context frames. A compiled program is reusable after any failure.

Resolvers are synchronous and return `{ found: true, value }` or a missing/denied resolution.
Thrown errors, promises, accessors, hostile proxies, cycles, sparse arrays, and non-JSON values are
contained as diagnostics. `evaluateWithClock` samples its clock exactly once per evaluation.

### Public entry points and non-goals

- `@kalada/core` retains only the versioned program envelope and Kuery adapters.
- `@kalada/core/kuery-v1` retains the Kuery 2.1 compatibility profile.
- `@kalada/core/kalada-v1` owns the native factories, types, schemas, analysis, values, codec, and
  compiler/evaluator.

The profile has no parser, module loader, imports, I/O, effects, scheduling, host-language function
interop, or async callbacks. Modules and imports are deferred to
[#21](https://github.com/surikaterna/kalada/issues/21), not implicitly enabled by function values.

Matches are limited to exactly two canonical arms: `some`, `none` for Option and `ok`, `err` for
Result. There are no guards or fallthrough. Bindings are lexical: an initializer is evaluated in
the outer scope, a body may shadow an outer binding, and only the selected match arm is evaluated.
Each evaluated expression node costs one step. Runtime ADT identity never survives object copying
or JSON serialization; use `encodeKaladaValue`/`decodeKaladaValue` at an interchange boundary.

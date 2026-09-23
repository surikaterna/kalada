# `@kalada/projection`

`@kalada/projection` compiles a canonical projection-v1 data structure into a deterministic,
bounded JSON projection. It uses explicit `@kalada/core` expression ASTs; strings in a
projection are always literal strings, never source expressions or interpolation templates.

The package is side-effect free and works in ESM, CommonJS, strict NodeNext TypeScript, and browser
bundles. Raw CDN URLs and unbundled native-browser/import-map loading are not supported; browser
support requires a package-aware bundler. Its only runtime dependency is `@kalada/core@^0.5.0`.

## Construct and evaluate a projection

```ts
import { KaladaV1 as K } from "@kalada/core";
import { ProjectionV1 as P, compileProjectionV1 } from "@kalada/projection";

const expression = (name: string) => K.program(K.ref(name));
const projection = P.program(
  P.object([
    P.entry("name", P.value(expression("name"))),
    P.entry(
      "active",
      P.if(expression("isActive"), P.value(K.program(K.literal(true)))),
    ),
    P.entry(
      "items",
      P.map(
        expression("items"),
        "item",
        "index",
        P.object([
          P.entry("value", P.value(expression("item"))),
          P.entry("position", P.value(expression("index"))),
        ]),
      ),
    ),
  ]),
);

const compiled = compileProjectionV1(projection);
const values = { name: "Ada", isActive: true, items: ["a", "b"] } as const;
const outcome = compiled.ok
  ? compiled.value.evaluate((name) =>
      name in values
        ? { found: true, value: values[name as keyof typeof values] }
        : { found: false },
    )
  : compiled;
// { ok: true, value: { name: "Ada", active: true,
//   items: [{ value: "a", position: 0 }, { value: "b", position: 1 }] } }
```

Resolvers must follow the synchronous `KaladaV1Resolver` contract. A compiled projection lists its
external `dependencies` and is reusable after success or failure. Use `evaluate(resolve, {
instant })` with an explicit core `Instant`, or `evaluateWithClock(resolve, clock)` to sample one
clock value once before evaluation and share it across every expression.

The schema is exported as `@kalada/projection/projection-v1.schema.json`. The package root exports
the factories, canonicalizer, compiler, diagnostics messages, default and maximum limits, and their
TypeScript contracts. There are no additional runtime entry points.

## Nodes, scope, and omission

Projection v1 has exactly five nodes:

- `value` evaluates one explicit canonical Kalada program;
- `object` evaluates ordered entries;
- `array` evaluates ordered items;
- `if` requires an exact boolean and evaluates only its selected branch;
- `map` evaluates one JSON array and then its body in order.

A map's `item` and zero-based `index` names are lexical. Nested maps resolve the nearest binding;
outer bindings remain visible, and the host resolver is called only after all map scopes. Maps do
not flatten their results.

Only `Option.none()` means omit. `Option.some(json)` emits its payload. Omission removes an object
field or compacts an array/map; a selected branch propagates omission. Root omission returns
exactly `{ ok: true, omitted: true }`. `null`, `false`, `0`, `""`, `[]`, and `{}` are ordinary values
and are never omitted. A missing reference or JavaScript `undefined` is an error, not omission.

```ts
const optional = P.program(P.value(K.program(K.Option.none())));
const compiled = compileProjectionV1(optional);
const outcome = compiled.ok
  ? compiled.value.evaluate(() => ({ found: false }))
  : compiled;
// { ok: true, omitted: true }
```

## Limits and security model

Compilation canonicalizes and recursively freezes the projection and every embedded core program.
It rejects accessors, inherited/extra/symbol properties, sparse arrays, duplicate or unsafe object
keys, invalid values, and over-limit structures. Evaluation is synchronous, deterministic,
left-to-right, fail-fast, and returns frozen diagnostics without exposing host exceptions.

`compileProjectionV1(program, { limits, coreLimits })` accepts partial inclusive limits.
`DEFAULT_PROJECTION_V1_LIMITS` and `MAXIMUM_PROJECTION_V1_LIMITS` publish the exact defaults and hard
ceilings for projection depth/nodes, object entries, array items, key/name length, expression
invocations, collection length/iterations, and output depth/nodes/UTF-8 bytes. Embedded expressions
also receive a fresh set of the selected core limits. Output accounting is transactional, so an
omitted or failed child never leaves partial output or consumes retained-output budget.

The runtime does not use Node built-ins, filesystem or network access, ambient `process`, dynamic
import, `eval`, the `Function` constructor, host callbacks other than the resolver/clock contracts,
or prototype mutation. It contains no parser, CST, LSP, module loader, imports, effects, async
evaluation, or source execution. Treat projection data and resolver results as untrusted input and
select limits appropriate to the host's resource budget.

## SelectTransform migration

SelectTransform is migration evidence, not a syntax or behavior specification. Migration is
classified as follows:

| Legacy behavior | Projection-v1 classification and replacement |
| --- | --- |
| Exact JSON substitution, explicit true/false branches, ordered loops | Supported equivalence through `value`, `if`, and `map` |
| Missing/`undefined` omission, truthiness, optional falsy/empty values, root/array omission | Intentional divergence; use exact booleans and explicit `Option.none()` |
| Nested loop scope | Intentional divergence; projection uses explicit lexical item/index names |
| Arbitrary JavaScript or callable output | Incompatible and excluded; build a canonical Kalada expression AST |
| String interpolation or source-expression strings | Incompatible and excluded; strings are literal, compose values explicitly |
| Implicit object loops, merge, or flatten | Incompatible and excluded; construct explicit objects and nested maps |
| Include/template lookup or `let` | Incompatible and excluded; resolve host data or use core lexical bindings explicitly |
| Modules, imports, or hooks | Deferred to [Kalada #21](https://github.com/surikaterna/kalada/issues/21) and absent from this release |
| Parser, syntax, CST, formatter, or LSP | Excluded from the projection package |

See [ADR-0004](../../docs/adr/0004-deterministic-projection-v1.md) for the complete canonical,
diagnostic, precedence, and accounting contract.

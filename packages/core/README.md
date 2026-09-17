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
program constructors and schemas, and a bounded compiler/evaluator. JSON values remain opaque:
only `decodeKaladaValue` decodes an encoded envelope, and every JSON value is wrapped in a `Json`
envelope so a discriminant-shaped object round-trips as ordinary JSON.

```ts
import { KaladaV1, compileKaladaV1Program } from "@kalada/core/kalada-v1";

const expression = KaladaV1.match("Option", KaladaV1.Option.some(KaladaV1.literal("Ada")), [
  KaladaV1.arm("some", KaladaV1.ref("name"), "name"),
  KaladaV1.arm("none", KaladaV1.literal("unknown")),
]);
const compiled = compileKaladaV1Program(KaladaV1.program(expression));
const value = compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
```

Matches are limited to exactly two canonical arms: `some`, `none` for Option and `ok`, `err` for
Result. There are no guards or fallthrough. Bindings are lexical: an initializer is evaluated in
the outer scope, a body may shadow an outer binding, and only the selected match arm is evaluated.
Each evaluated expression node costs one step. Runtime ADT identity never survives object copying
or JSON serialization; use `encodeKaladaValue`/`decodeKaladaValue` at an interchange boundary.

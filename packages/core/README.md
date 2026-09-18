# `@kalada/core`

This dependency-free package owns Kalada's canonical native v1 runtime contracts. The package root
is the only supported runtime entry point; `./kalada-v1`, `./kuery-v1`, and direct `./dist/*` access
are not exported.

```ts
import { KaladaV1, compileKaladaV1Program } from "@kalada/core";

const expression = KaladaV1.match("Option", KaladaV1.Option.some(KaladaV1.literal("Ada")), [
  KaladaV1.arm("some", KaladaV1.ref("name"), "name"),
  KaladaV1.arm("none", KaladaV1.literal("unknown")),
]);
const compiled = compileKaladaV1Program(KaladaV1.program(expression));
const value = compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
```

The root provides canonical program factories and schemas, static function analysis, private
WeakSet-branded `Option`/`Result` and temporal values, explicit value encoding, and a bounded
compiler/evaluator. Typed functions are lexical values and execute through an iterative
continuation machine. Core `map`, `filter`, `some`, and `every` callbacks preserve input order and
are bounded by configured limits.

Resolvers and clocks are synchronous. An ordinary, unmodified current-realm Promise is rejected as
`KALADA_ASYNC_UNSUPPORTED`; its rejection is consumed through a captured intrinsic. Cross-realm,
subclassed, proxied, and spoofed candidates are contained without a general attachment guarantee.
A hostile or unusable own constructor receives the same deterministic diagnostic without attachment,
reading getters, invoking `then` or constructors, mutating descriptors, or intercepting host-global
rejection handling. The host that created such a candidate remains responsible for any pre-existing
rejection. Other throws, accessors, proxies, cycles, sparse arrays,
and invalid values are contained as frozen diagnostics. `evaluateWithClock` samples its clock
exactly once per evaluation.

The package has no parser, module loader, imports, I/O, effects, scheduling, host-language function
interop, or async callbacks. Modules and imports remain deferred to
[#21](https://github.com/surikaterna/kalada/issues/21). Historical release details remain in
`CHANGELOG.md`; the retained Promise hardening helper's provenance and license are recorded in the
shipped provenance and third-party notice files.

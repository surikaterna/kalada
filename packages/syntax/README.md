# `@kalada/syntax`

Dependency-light source tooling for Kalada v1 expressions. The package provides a lossless token
stream and typed CST, deterministic diagnostics and formatting, and lowering to the canonical
`@kalada/core` program contract. It supports Node ESM, Node CommonJS, and browser use through a
package-aware bundler. Raw CDN URLs and unbundled native-browser/import-map loading are not
supported; “browser-safe” refers only to the bundled path.

```ts
import {
  formatKaladaV1Expression,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";

const parsed = parseKaladaV1Expression("price * quantity");
const lowered = lowerKaladaV1Expression(parsed, {
  references: {
    price: { reference: "price", type: { kind: "primitive-type", name: "number" } },
    quantity: { reference: "quantity", type: { kind: "primitive-type", name: "number" } },
  },
});
const formatted = formatKaladaV1Expression("price*quantity");
```

The frozen initial grammar includes literals, ASCII references, grouping, field navigation,
arithmetic, comparisons, membership, strict boolean operators, Option coalescing, and ternary
conditionals. Calls, arrays/objects, constructors, match, functions, imports, and modules are
intentionally not source forms in this release.

Ranges are half-open UTF-16 offsets. Supplying `references` closes the source environment; omitted
names then fail lowering. Structured references require a matching `coreOptions.reference` codec.

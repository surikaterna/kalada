# `@kalada/syntax`

Dependency-light, browser-safe source tooling for Kalada v1 expressions. The package provides a
lossless token stream and typed CST, deterministic diagnostics and formatting, and lowering to the
canonical `@kalada/core` program contract.

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

### Experimental guest-owned expression prefix

`experimentalParseKaladaV1GuestExpressionPrefix(source, start, options?)` is an opt-in
**provisional** public entry for a host that has *already declared* a Kalada expression slot.
`start` is the UTF-16 offset immediately after the host opener in the **original document**;
no host grammar is detected or registered by syntax. For example:

```ts
import { experimentalParseKaladaV1GuestExpressionPrefix, lowerKaladaV1Expression } from "@kalada/syntax";

const source = 'text ${price + 1} after';
const guest = experimentalParseKaladaV1GuestExpressionPrefix(source, source.indexOf("${") + 2);
if (guest.ok && source[guest.stop] === "}" && guest.parsed) {
  const lowered = lowerKaladaV1Expression(guest.parsed);
  // The host owns and consumes the closing brace; lowering does not evaluate values.
}
```

The immutable `ExperimentalKaladaV1GuestPrefixResult` reports `ok`, `range` (half-open
`[start, stop)`), `stop`, `reason`, `diagnostics` and `parsed` (a parse result against the
original document with absolute UTF-16 token/CST/diagnostic and lowering source-map ranges).
The guest stops *before* the first outer `}` outside a supported double-quoted string;
whitespace before it belongs to the guest. `ok` only means a complete, currently supported
Kalada expression ended at that boundary without syntax diagnostics. The host **must** check
`source[stop] === "}"` and its own slot rules before consuming anything or authorizing
lowering/emission; `parsed` on failure is recovery data, **not** permission to emit.
Reasons are `outer-brace`, `unmatched-parentheses`, `unsupported-comment`,
`unsupported-quote`, `eof`, `limit`, or `invalid-start`. Unsupported comments, single quotes,
backticks and brace forms fail closed today; this is not a promise to exclude them from future
Kalada grammar. An unterminated supported double string may obscure a host brace; bounded
scanning fails closed rather than guessing ownership. `options.limits` uses the same validated
syntax limits as whole-expression parsing (including source-window, token and diagnostic
budgets); no evaluator is invoked. The API name and shape may change before stabilization.
This is not a Formbar/FSX parser, automatic host integration, or a replacement for
`parseKaladaV1Expression`.

Successful lowering returns the canonical `program`, its `sourceMap`, and syntax's authoritative
`resultType`. The result projection is `"dynamic"` or a core `KaladaType`; internal uncertainty such
as an option with an unknown payload is projected as `"dynamic"`.

`queryKaladaV1Semantics(parsed, options?)` reports immutable subtree types, field-access support, and
operator support from the same lowering dispatch internals. It retains useful complete-child facts in
recovered incomplete source without adding grammar or evaluating values.

The frozen initial grammar includes literals, ASCII references, grouping, field navigation,
arithmetic, comparisons, membership, strict boolean operators, Option coalescing, and ternary
conditionals. Calls, arrays/objects, constructors, match, functions, imports, and modules are
intentionally not source forms in this release.

Ranges are half-open UTF-16 offsets. Supplying `references` closes the source environment; omitted
names then fail lowering. Structured references require a matching `coreOptions.reference` codec.

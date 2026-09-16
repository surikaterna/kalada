# `@kalada/core`

This dependency-free package owns Kalada's canonical, versioned runtime contracts. The root
exports the four-field `KaladaProgramV1` envelope, its strict canonicalizer, and Kuery-expression
adapters. It intentionally does not export a compiler, evaluator, profile, parser, effects, or
scheduling semantics.

The exact Kuery 2.1 strict-expression compatibility API is available only from
`@kalada/core/kuery-v1`. Provenance is recorded in the shipped `provenance/kuery-2.1.0.json`, and
third-party license declarations are reproduced in `THIRD_PARTY_NOTICES.md`.

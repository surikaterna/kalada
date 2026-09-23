# Kalada

Kalada is a deterministic, expression-oriented language designed for portable, versioned
evaluation contracts. The dependency-free `@kalada/core` package exposes the native Kalada v1 API
at its canonical root. The native profile
supports typed lexical functions, bounded recursion, and the `map`, `filter`, `some`, and `every`
core function values in addition to Option, Result, temporal values, and exhaustive matches.

See the [core API guide](packages/core/README.md),
[syntax API guide](packages/syntax/README.md), and
[projection API and migration guide](packages/projection/README.md) for executable examples,
limits, security boundaries, omission semantics, and public entry points. Projection v1 constructs
JSON with explicit core expression ASTs and the five bounded `value`, `object`, `array`, `if`, and
`map` nodes. It does not execute source strings, interpolation, arbitrary JavaScript, truthiness,
merge/flatten/include/let, or implicit loops.

Modules and imports remain explicitly deferred to
[#21](https://github.com/surikaterna/kalada/issues/21); this release does not add module loading,
host effects, or asynchronous evaluation. See
[ADR-0001](docs/adr/0001-kalada-language-architecture.md) for the accepted boundaries and
[ADR-0004](docs/adr/0004-deterministic-projection-v1.md) for the complete projection-v1 contract.

## Package environments

The packages support Node ESM, Node CommonJS, NodeNext declarations, and browser use through a
package-aware bundler. Raw CDN package URLs and unbundled native-browser/import-map loading are not
supported. In particular, core's generated ESM wrapper deliberately shares its CommonJS runtime,
and syntax/projection retain package-manager-resolved imports. See the
[package environment support matrix](docs/package-environment-support.md) and
[ADR-0007](docs/adr/0007-package-runtime-and-browser-policy.md) for the exact boundary and evidence.

Published packages require Node `>=22.0.0`. Bun `1.4.2` is the repository toolchain, not a separate
packed-package runtime guarantee. No package exposes a `browser` condition.

## Development

The repository pins Bun in `package.json` and uses a Bun workspace.

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run package:policy
bun run package:smoke
bun run projection:smoke
bun run syntax:smoke
bun run syntax:browser-smoke
```

Changes to publishable packages require a Changeset. Publication is owned by the protected
GitHub Actions release workflow and npm trusted publishing; local or manual publication is not
part of the development workflow. The one-time projection 0.1.0 bootstrap is closed and must not
be repeated; its immutable release record is
[docs/releases/kalada-projection-0.1.0-bootstrap.md](docs/releases/kalada-projection-0.1.0-bootstrap.md).

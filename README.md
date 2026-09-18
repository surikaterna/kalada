# Kalada

Kalada is a deterministic, expression-oriented language designed for portable, versioned
evaluation contracts. The dependency-free `@kalada/core` package exposes the extracted Kuery
compatibility kernel and the additive native `@kalada/core/kalada-v1` profile. The native profile
supports typed lexical functions, bounded recursion, and the `map`, `filter`, `some`, and `every`
core function values in addition to Option, Result, temporal values, and exhaustive matches.

See the [package API guide](packages/core/README.md) for executable examples, limits, and public
entry points. Modules and imports remain explicitly deferred to [#21](https://github.com/surikaterna/kalada/issues/21);
this release does not add module loading, host callbacks, effects, or asynchronous evaluation. See
[ADR-0001](docs/adr/0001-kalada-language-architecture.md) for the accepted boundaries and
[ADR-0004](docs/adr/0004-deterministic-projection-v1.md) for the projection-v1 contract.

## Development

The repository pins Bun in `package.json` and uses a Bun workspace.

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run package:smoke
```

Changes to publishable packages require a Changeset. Publication is owned by the protected
GitHub Actions release workflow and npm trusted publishing; local publication is not part of
the development workflow.

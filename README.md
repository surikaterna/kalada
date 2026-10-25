# Kalada

## Runtime security (CVE-2026-111497)

The workspace pins Bun1.4.4; CI and publishing pin Node24.22.1. Node consumers require22.23.4,24.22.1 or26.12.1 (or newer patched releases on those supported lines).

See the [Node October 2026 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) and [Bun advisory](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p). Rebuild and redeploy affected images and artifacts; existing deployments and previously compiled executables are not updated by this source change.

Shared patched-runtime smoke safely round-tripped HTTP `Content-Encoding: br` through native fetch on Node22.23.4,24.22.1,26.12.1 and Bun1.4.4. This is runtime evidence, not an application-suite or exploit test.


Kalada is a deterministic, expression-oriented language designed for portable, versioned
evaluation contracts. The dependency-free `@kalada/core` package exposes the native Kalada v1 API
at its canonical root. The native profile
supports typed lexical functions, bounded recursion, and the `map`, `filter`, `some`, and `every`
core function values in addition to Option, Result, temporal values, and exhaustive matches.

See the [experimental neutral diagnostic routing guide](packages/provider-routing/README.md),
[core API guide](packages/core/README.md),
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

## Development

The repository pins Bun in `package.json` and uses a Bun workspace.

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
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

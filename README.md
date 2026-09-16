# Kalada

Kalada is a deterministic, expression-oriented language designed for portable, versioned
evaluation contracts. This repository currently contains only the architecture and the
`@kalada/core` package shell.

Language semantics are intentionally deferred. See
[ADR-0001](docs/adr/0001-kalada-language-architecture.md) for the accepted boundaries and
implementation sequence.

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

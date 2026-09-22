# Kalada demo

This private Vite app supports the bundled GitHub Pages build only. The canonical deployed URL is
`https://surikaterna.github.io/kalada/`, built with `DEMO_BASE=/kalada/`. That one route can be loaded
directly and reloaded; the app does not provide an SPA fallback or any other route.

An ordinary local build keeps Vite's `/` default. The production-artifact E2E command builds once at
`/kalada/`, verifies and cleans that exact `dist`, then serves it with a strict local preview:

```sh
bun run test:e2e
```

This evidence covers only assets and dynamic imports produced by the bundler. It makes no direct CDN
URL or unbundled import-map compatibility claim. [Issue #81](https://github.com/surikaterna/kalada/issues/81)
owns that separate package-policy decision.

## Security evidence boundary

The check is deliberately artifact-specific. It parses each JavaScript asset from the exact production
build, records its direct imports, selected browser/Node capability syntax, and URL-like literals, and
ties those observations to content digests and the normalized Vite static/dynamic module closure. It
rejects direct dynamic-code, Node/runtime, network, service-worker, active foreign/root URL, and direct
capability-mutation syntax. CSP and browser request interception provide the runtime boundary.

This is a bounded observed-syntax inventory for the pinned emitted artifact, **not** a sound JavaScript
alias, data-flow, or mutation analysis and not a security claim about arbitrary JavaScript programs.
Inert schema identifiers and dependency feature probes remain visible in the reviewed inventory.

To intentionally update the frozen evidence:

1. Run `DEMO_BASE=/kalada/ bun run --cwd apps/demo build` from the repository root.
2. Run `bun scripts/demo-e2e/update-artifact-inventory.ts`.
3. Review every byte digest, import, capability/URL count, closure role, and contributor diff in
   `scripts/demo-e2e/expected-artifact-inventory.json`.
4. Run the focused artifact tests and the full managed-browser E2E before approval.

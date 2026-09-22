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

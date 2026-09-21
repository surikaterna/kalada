# Package environment support

This matrix is the support contract accepted by
[ADR-0007](adr/0007-package-runtime-and-browser-policy.md). It distinguishes package installation,
module loading, declaration resolution, and browser delivery rather than treating “ESM” as one
environment.

## Environment matrix

| Environment | Status | Evidence and boundary |
| --- | --- | --- |
| Node ESM | Supported on Node `>=22.0.0` | Packed root resolves through `exports.import.default`; runtime consumers execute from an npm-installed tarball. |
| Node CommonJS | Supported on Node `>=22.0.0` | Packed root resolves through `exports.require.default`; runtime consumers execute from the same installation. |
| TypeScript NodeNext ESM | Supported | Packed `.mts` consumer resolves `exports.import.types` to `dist/index.d.ts`. |
| TypeScript NodeNext CJS | Supported | Packed `.cts` consumer resolves `exports.require.types` to `dist/index.d.cts`; declaration pairs must match. |
| Package-manager installation | Supported | npm tarballs are installed together and dependency deduplication, file allowlists, and public subpaths are checked. |
| Browser through a package-aware bundler | Supported | A browser-target bundle is built from installed tarballs for core, syntax, and projection and checked for Node module hooks before execution. |
| Raw CDN package URL | Unsupported/deferred | Core's ESM wrapper imports CommonJS; no real-browser packed URL evidence exists. |
| Native browser ESM with an import map | Unsupported/deferred | Mapping syntax/projection's bare core specifier does not make core's CommonJS implementation browser-native. |
| Bun packed-package runtime | Not separately guaranteed | Bun `1.4.2` is the repository toolchain; package runtime support is not claimed independently of the tested Node/browser-bundler paths. |

“Browser-safe” in package documentation means compatible with the supported browser-bundler path.
It does not mean that a package root can be used as a `<script type="module">` URL or import-map
target without transformation.

## Packed baseline audit

Audit date: 2026-09-21. Source commit:
`225c60ee0024bb20b8843854a4d9c9187c8e7f41`.

| Package | Packed files | Runtime imports | Public exports |
| --- | --- | --- | --- |
| `@kalada/core@0.5.0` | `README.md`, `THIRD_PARTY_NOTICES.md`, `dist/index.cjs`, CJS source map, `dist/index.js`, `.d.ts`, `.d.cts`, `package.json`, provenance JSON | ESM wrapper: `./index.cjs`; CJS bundle: none | `.`, `./package.json` |
| `@kalada/syntax@0.0.0` | `README.md`, ESM/CJS runtime and source maps, `.d.ts`, `.d.cts`, `package.json` | ESM/CJS: `@kalada/core` | `.`, `./package.json` |
| `@kalada/projection@0.1.0` | `README.md`, ESM/CJS runtime and source maps, `.d.ts`, `.d.cts`, `package.json`, `projection-v1.schema.json` | ESM/CJS: `@kalada/core` | `.`, `./projection-v1.schema.json`, `./package.json` |

For every package, the root export has this exact ordered shape:

```json
{
  "import": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  },
  "require": {
    "types": "./dist/index.d.cts",
    "default": "./dist/index.cjs"
  }
}
```

All three retain `main: "./dist/index.cjs"`, `module: "./dist/index.js"`,
`types: "./dist/index.d.ts"`, `sideEffects: false`, and `engines.node: ">=22.0.0"`. None has a
`browser` condition or field. Core has no runtime dependencies. Syntax and projection each have
exactly `@kalada/core: "^0.5.0"`; no package has runtime peer, optional, or bundled dependencies.

Package roots and the explicitly listed metadata/schema subpaths are public. Source files,
`dist/*`, and historical `kalada-v1`/`kuery-v1` paths are internal even when a tarball physically
contains a target file.

## Future-package checklist

Before a new package can be called supported, its owner must:

1. add it to this environment matrix with each environment marked supported or unsupported;
2. define and test exact packed files, public exports, condition order, declarations, engines,
   dependencies, and emitted transitive imports;
3. prove Node ESM/CJS only when claimed and preserve both unless a major migration is approved;
4. prove browser-bundler use from its packed tarball before making a bundled-browser claim;
5. provide real no-bundler browser evidence before making a raw CDN/import-map claim;
6. keep optional vendor dependencies isolated and demonstrate they are absent from unrelated browser
   bundles; and
7. add an impact-appropriate Changeset whenever the publishable package surface changes.

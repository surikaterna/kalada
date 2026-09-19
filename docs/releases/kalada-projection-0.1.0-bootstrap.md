# `@kalada/projection@0.1.0` bootstrap release record

This immutable record closes the one-time owner-manual bootstrap authorized by Kalada #44/#48.
The artifact was built from exact source SHA
`7ec71273a1f916135838cb84e2eded8d594e0e5e` and published at
`2026-09-19T06:40:44.765Z`. The audited owner command was:

```sh
npm publish /tmp/opencode/kalada-projection-bootstrap/kalada-projection-0.1.0.tgz --access public
```

The recoverable build toolchain is Bun 1.4.2 and tsup 8.5.1. Registry metadata records Node
24.20.0 and npm 11.19.0 for the manual publication. The exact pre-publish E404 and owner command
were independently audited at
[Kalada #48 audit](https://github.com/surikaterna/kalada/issues/48#issuecomment-5737147460).
The registry artifact, consumers, and signature were independently verified at
[Kalada #48 post-publication audit](https://github.com/surikaterna/kalada/issues/48#issuecomment-5740041390)
and finalized in the
[registry disposition](https://github.com/surikaterna/kalada/issues/48#issuecomment-5740052525).

## Artifact identity

- Packed size: 52,017 bytes; unpacked size: 252,014 bytes; 9 files.
- SHA-1: `3cbb7dcb6df23c8ce91b7d77ebfc91ac7009c49f`.
- SHA-256: `99346eee84ca1dc61db2033d123ef9a012e89c6e79692beac9418e8900672463`.
- npm integrity:
  `sha512-mqUomAF+BkLCiNyniGCrfTSVo4hCYW06GNW05H+wl7veTOOpf6TckpaqngsRt9EDpgoi0wvlWkKIQ2lpoQf47g==`.

| File | Bytes |
| --- | ---: |
| `README.md` | 6,368 |
| `dist/index.cjs` | 32,040 |
| `dist/index.cjs.map` | 83,752 |
| `dist/index.d.cts` | 5,157 |
| `dist/index.d.ts` | 5,157 |
| `dist/index.js` | 31,851 |
| `dist/index.js.map` | 83,683 |
| `package.json` | 1,172 |
| `projection-v1.schema.json` | 2,834 |

The packed manifest names `@kalada/projection` version `0.1.0`, is public, requires Node 22 or
newer, and has no lifecycle scripts or bundled dependencies. Its sole runtime dependency is
`@kalada/core: ^0.5.0`. Its exports are exactly:

```json
{
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  },
  "./projection-v1.schema.json": {
    "import": "./projection-v1.schema.json",
    "default": "./projection-v1.schema.json"
  },
  "./package.json": "./package.json"
}
```

## Registry and provenance disposition

npm reports `0.1.0` as both the sole version and `latest`. The registry tarball is byte-identical
to the audited artifact. Its npm registry signature was cryptographically verified over the exact
integrity value with non-expiring key
`SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`.

The manifest, three exports, dependency, ESM/CJS/strict NodeNext/browser consumers, schema, and one
physical `@kalada/core@0.5.0` identity were verified from the registry. npm metadata has no
`gitHead`, and the attestation endpoint returned HTTP 404. This manual release has **no GitHub
Actions OIDC, npm trusted-publisher, or SLSA provenance**; none is claimed retroactively.

The npm owner subsequently confirmed that trusted publishing is configured for organization
`surikaterna`, repository `kalada`, workflow `release.yml`, and no environment in
[Kalada #49](https://github.com/surikaterna/kalada/issues/49#issuecomment-5740582614). All future
publications must use the protected Changesets release workflow with OIDC and provenance. Do not
repeat, republish, or otherwise use a manual bootstrap for this package/version.

# ADR-0007: Package runtime and browser policy

- Status: Accepted
- Date: 2026-09-21
- Decision source: [Kalada #81](https://github.com/surikaterna/kalada/issues/81)
- Architecture context: [ADR-0006](./0006-prepared-execution-schema-tooling.md)
- Audited baseline: `225c60ee0024bb20b8843854a4d9c9187c8e7f41`
- Support matrix: [Package environment support](../package-environment-support.md)

## Context and evidence

The three publishable packages already work through Node's ESM and CommonJS loaders, strict
NodeNext declarations, and browser bundling. Those are different capabilities from loading a raw
package URL in a browser. A bundled-browser smoke test cannot establish direct CDN or native
import-map compatibility, so support claims and package metadata need one explicit policy.

The baseline packed-artifact audit found:

- every package ships one runtime root with ordered `import` and `require` branches, each selecting
  `types` before `default`; only `package.json` and projection's JSON schema are additional exports;
- every package retains `main`, `module`, `types`, `sideEffects: false`, a package file allowlist,
  declaration files for both loaders, and `engines.node: ">=22.0.0"`;
- core packs a bundled CJS implementation plus a generated ESM wrapper. The wrapper imports
  `./index.cjs` and re-exports the same runtime objects, preserving singleton and private-brand
  identity when ESM and CJS coexist in one process;
- syntax and projection ESM artifacts have one bare runtime import, `@kalada/core`; their CJS
  artifacts require that package. Core has no package dependency, while syntax and projection each
  declare only `@kalada/core: "^0.5.0"` at this baseline;
- paired `.d.ts` and `.d.cts` files are byte-identical. Source, tests, and unexported `dist` paths
  are absent from the public package surface;
- the packed core ESM file is not native-browser ESM because it imports CJS, and syntax/projection
  retain bare package specifiers. An import map could map the bare dependency but cannot make the
  core CommonJS implementation browser-native.

The exact audited contents and environment claims are recorded in the separate support matrix.

## Decision

Kalada supports all of the following for `@kalada/core`, `@kalada/syntax`, and
`@kalada/projection`:

1. Node ESM on every supported Node release;
2. Node CommonJS on every supported Node release;
3. matching declarations selected for ESM and CommonJS consumers;
4. browser use after a package-aware bundler resolves and bundles the installed packages.

Raw CDN package URLs and unbundled native-browser/import-map loading are explicitly unsupported and
deferred. Documentation must not describe either path as supported. A future claim requires packed,
immutable artifacts loaded in a real browser without bundler rewriting, Node resolution, or a dev
server transform. The evidence must cover every claimed entry point and its transitive imports,
record browser module/network failures, and use pinned CDN URLs or an equivalent immutable local
artifact server.

The current export maps are minimal and remain unchanged. There is no demonstrated alternate
browser implementation, so a `browser` condition would add ambiguity without capability and is
forbidden. Condition order remains `import` before `require`, with `types` before `default` inside
both branches. Internal paths stay unexported.

Core's CJS bundle is the runtime source of truth. Its ESM entry remains a generated wrapper from the
repository wrapper generator, not a second bundled implementation. Both loaders must expose the
same runtime keys and object identity. Removing the wrapper, changing its direction, or splitting
the implementations requires separate compatibility evidence and major-change approval.

The package fields `main`, `module`, `types`, `sideEffects`, `files`, declarations, dependency
boundaries, and `engines.node` remain policy-controlled. The Node floor is exactly `>=22.0.0`, and
CI must exercise packed consumers on Node 22.0.0 as well as the repository's normal quality job.
Bun 1.4.2 is the pinned repository install/build/test toolchain. Published packages do not declare a
Bun engine and do not separately guarantee Bun as a packed-package runtime.

## Enforcement and future-package gate

The deterministic `package:policy` gate packs all three packages and verifies tarball contents,
field and export order, condition targets, dependencies and emitted imports, declaration parity,
wrapper provenance and identity, internal-path exclusion, Node ESM/CJS behavior, NodeNext types,
and bundled-browser behavior. It also rejects any `browser` condition. CI runs this gate and a
focused Node 22.0.0 packed-consumer job.

Every future publishable package must declare its intended environments before publication and be
added to the support matrix and policy gate. At minimum it must provide packed-artifact evidence for
its file allowlist, minimal exports and condition order, declarations, engines, dependency/import
boundary, internal-path exclusion, and each claimed runtime. A browser claim must distinguish
bundled use from native URL/import-map use. Optional schema vendors such as Scheman or Zod must stay
outside host bundles unless a separately tested package or entry point intentionally includes them.

Any proposed CJS removal, engine-floor increase, exported-path removal, condition reordering with a
resolution effect, or direct-browser redesign is potentially breaking. It must stop at evidence and
move to a separately approved major issue rather than being implemented under this policy gate.

## Consequences

Consumers retain existing Node and bundler behavior, including core's cross-loader singleton
identity. The policy adds repeatable evidence without changing a package manifest or runtime
surface. Direct browser loading remains unavailable until its transitive CommonJS and bare-specifier
constraints are deliberately redesigned and tested.

This decision and its enforcement are documentation, tests, scripts, and CI only. No publishable
package surface changes, so issue #81 intentionally has no Changeset. Release workflow and release
PR #63 are outside scope.

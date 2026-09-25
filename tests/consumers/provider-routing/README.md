# #137 packed consumer evidence

Run `bun run provider-routing:packed-consumers` after `bun install --frozen-lockfile`.
Implementation and evidence source: `scripts/provider-routing-packed-consumers.ts`
(isolated command runner, artifact contents, lockfile/recursive physical install/npm ls
graph checks, consumer commands and Changesets plan); `domain.mjs` owns the independent
rule; `../provider-routing-optin/esm.mjs` owns pinned results, parity and registration.
The script versions a temporary Changesets release workspace, verifies that the planned
router version advances beyond the source manifest, and packs that planned version
(for example, `@kalada/provider-routing@0.1.0` when the source is `0.0.0`). It performs **two**
fresh `/tmp/kalada-packed-router-*` npm installs with `--offline --ignore-scripts --no-audit
--no-fund --cache <fresh directory>` and a deliberately unreachable registry. It inspects each
`package-lock.json` (`file:../*.tgz`, integrity, no links), recursive physical `node_modules`
(`lstat` including nested symlinks, package names, installed manifest versions), and
`npm ls --all --json` (exact names, versions, local archive resolutions and dependency
edges, allowing npm's abbreviated deduplicated transitive nodes). It rejects extra installs.
No fixture imports repository paths. TypeScript is invoked from the build workspace only as
a compiler; its NodeNext resolution is from each independent consumer directory.

Domain-only graph: planned `@kalada/provider-routing` with **no** dependencies (no core,
syntax, host, language-service, or editor). `esm.mjs`, `cjs.cjs`, strict NodeNext `types.mts`
and `types.cts` exercise public exports. The consumer's own `domain.mjs` resolves a name
against explicit `names-v1` allowed names `alpha`/`beta` and `names-v2` names `beta`/`gamma`:
the same `use alpha` changes from supported to invalid `[4,9)`; `use gamma` reverses.
`🚀\r\nuse absent` yields `DOMAIN_UNKNOWN_NAME` at UTF-16 offsets `[8,14)`.
Valid, unsupported third generation,
malformed result, throwing provider, source bound, duplicate/unknown registration, invalid
document and caller-owned snapshot identity are checked.

Example opt-in graph after `copyChangesetReleaseWorkspace` + local `changeset version`
(versions depend on source manifests and pending Changesets):
`@kalada/provider-routing@0.1.0` (no deps), `@kalada/core@0.6.0` (no deps),
`@kalada/syntax@0.1.0` (core `^0.6.0`), `@kalada/host@0.1.0` (core `^0.6.0`,
syntax `^0.1.0`), `@kalada/language-service@0.1.0` (core `^0.6.0`, host `^0.1.0`,
syntax `^0.1.0`). Only these five locally packed archives may appear in the lockfile;
the script also rejects incompatible release-plan dependency lines. For this example,
the *source* manifests are core `0.5.0`, router/host/syntax/language-service `0.0.0`;
packing source manifests without the local Changesets plan would not prove the intended
release graph.
The script checks the planned router name, valid numeric release version and advance
over the source version, then matches its packed manifest; both isolated installs use
that same versioned archive, not an unversioned source package. Multiple pending minor
Changesets do not imply an additional minor bump before release.

Opt-in `esm.mjs` registers the **real** public `createExpressionsDiagnosticProvider`
beside the domain provider in one public router. It checks missing/mismatched generation,
valid `price + 1`, invalid `unknown` (`KALADA_SYNTAX_UNKNOWN_REFERENCE`), incomplete
`1 +` (`KALADA_SYNTAX_EXPECTED_EXPRESSION`, `[3,3)`) and astral+CRLF
`"😀" - 1\r\n` (`KALADA_OPERATOR_TYPE`, `[0,4)`) by checking fixed ordered codes and
half-open UTF-16 offsets derived from direct LS output and separately comparing to a
fresh public language-service diagnostics call. Also exercises ESM/CJS and
strict NodeNext `.mts`/`.cts`, duplicate/unknown registration, source bound and resolver
failure. Both consumers bundle `browser.mjs` from their respective fresh packed installs
with `bun build --target=browser --format=iife`; metafiles reject workspace source,
unexpected dependencies and external imports. Both evaluate the result in a VM with
browser-standard `TextEncoder`/`TextDecoder`; this is a bundle/runtime smoke, **not** a real-browser
compatibility or performance claim.

Whole-document diagnostic parity does **not** demonstrate shared type/expected-value
versus writable-location checking, public parser API composition (the parser API
now exists, but this diagnostic fixture does not test it), complete CF02/CF13,
or an API freeze. Currentness of caller-owned snapshots is the caller's responsibility;
the adapter resolves the environment per request. These gaps remain on #111 for the
#123 evidence ledger. Tests/scripts only; no changeset is warranted.

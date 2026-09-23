# Issue #98 experimental B: demo inventory reconciliation

The audit-reported `assets/index-DjzHyywc.js` is the **root-base** artifact:
`bun run build` defaults `DEMO_BASE` to `/`. Its HTML SHA-256 is
`1d7e15e34b7bc8a50c1c5f0e787e8b4dbf1cca8a1566ce205112275721a0d2d9`,
and entry JS SHA-256 is
`440994eda00ee7054ecf8998653be0578ac76ba7dafff5c4e6cdf954ba183212`.
It must not be compared to the Pages `/kalada/` inventory. The production demo
smoke invokes `buildAndVerifyArtifact`, which removes `dist`, builds with
`env: { ...process.env, DEMO_BASE: "/kalada/" }`, checks its exact closure,
and then launches preview. Inspecting a preceding default-base `dist` is
not equivalent to running that smoke.

There was also a **real stale committed B inventory**: even after the correct
Pages-base build, the old inventory expected `index-Cxumpsh9.js`, whereas
the completed B source deterministically emits `index-D7FDmWgP.js`. The old
hashed chunks were not retained, so their original bytes cannot be compared;
the evidence does not establish precisely when the stale snapshot was taken.
Do not attribute it to a specific toolchain update or silently waive the
inventory check.

Before regenerating, `inspectArtifact(false)` was compared file by file against
the committed inventory and A. The reviewed delta from the old B inventory is
**only**:

| Closure | Old B file / SHA-256 | Current B file / SHA-256 | Other change |
| --- | --- | --- | --- |
| Lazy environment | `environment-C1PYiEog.js` / `aa95780c39e94c67dd752397ac104c7d761389d1b7258723e9b1ad2fd8b43fc6` | `environment-0yF8CA8T.js` / `683d1f7c7dcd2fe613c3054d1037c223720d121cd4846b54d755bb1a319851de` | Static import filename updated to new entry |
| Entry JS | `index-Cxumpsh9.js` / `70e727b46df4920d3d8a05fcf68a70ed1da06fe8cf33ce67f4a5f646dd552539` | `index-D7FDmWgP.js` / `a440f81e3adb7ee4cbd94969f533fd68f5b1dad83f3964c50eb267e3daebba38` | Dynamic import filename updated to new environment |
| HTML | `86efe4295143f2dc5cf51e8bbc6db5498a9fbc9f64c72a3079cbdbb5bc9009b7` | `1894237137ddc89b0f4abece579dc6de45ec18e11e6730b9a4d1b110a9af2319` | References new entry JS |
| CSS | `index-DFUGms7F.css` / `5ed89109ec26aeacd9476735bbf720513d70481d277716494fe7e268e46501cf` | Identical | None |

For **every** file, closure classification, capability counts, URL-literal
counts, and contributor lists are unchanged; import counts and import *kind*
are unchanged (only the two content-addressed names above differ). There is
no vendor or unexpected module added relative to the old B inventory.

Against the independently rebuilt A (`78d624f536d73db5ae813de5f64d8bd52fa07b29`),
the B entry grows from **557,088 to 558,109 bytes** and first differs at
byte offset **502,526**, where B's syntax cache begins. The only additional
entry contributor is `packages/language-service/src/syntax-cache.ts`. The
104,508-byte lazy-environment chunks are byte-identical after replacing A's
entry import filename with B's; their different hash does not indicate new
environment logic. A's fresh Pages-base artifact reproduced its *committed*
inventory exactly. Its capabilities and URL-literal counts equal B's.

The B worktree's `bun.lock` SHA-256 stayed
`3dcc9bd69f80040eb6192d0699c977c8db8c2a2c2b16c066277959c66637f5a5`;
`bun install --frozen-lockfile` reported **no changes**. Bun 1.4.2, Vite
8.3.0, Rolldown 1.2.9 and pinned workspace dependencies were inspected.
There were no simultaneous Kalada builds during the serial reproduction.
Three serial `/kalada/` builds in B, including one after frozen install,
produced the same two JS SHA-256 hashes above. A second, clean detached
worktree at the immutable B commit, installed from the frozen lock, emitted
the **same** B hashes and HTML. The result does not depend on a dirty source
tree, stale `dist`, or a concurrent package build. A serial root-base build
reproduced `index-DjzHyywc.js` before a `/kalada/` rebuild restored
`index-D7FDmWgP.js`.

Only after inspecting those differences was the provided
`bun scripts/demo-e2e/update-artifact-inventory.ts` run. The resulting
inventory diff has precisely the four rows above—no permission, package,
build-config, or runtime behavior change. `inspectArtifact()` now passes its
strict expected-inventory check. The nine managed Chromium **153.0.8010.12**
demo E2E scenarios pass after the full package/browser smoke sequence, which
itself leaves a default-base `dist`. This is a sandbox evidence correction,
not approval to merge experimental B or to reinterpret the earlier A/B data.

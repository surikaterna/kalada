# Issue #98: attribution gate on immutable A

Source A: PR #97 `78d624f536d73db5ae813de5f64d8bd52fa07b29` (detached
`trees/98-a-readonly`); measurement tooling: PR #100
`376a2c91eb5265706b6572439ebd95b74f7adb7a` plus this branch. Main
at measurement start: `b694fa654938392d7f01367f7ac3d31278ce2d51`.
Both PRs were open and unmerged. No tracked A file was modified.

## Method and samples

Unmodified A: `bun install --frozen-lockfile && bun run build`, preview
`/kalada/` on loopback port 4179. Benchmark-only `node
scripts/browser-bench/98-build.mjs` resolves A *source* through Vite aliases,
injects probes into the syntax, LS, CodeMirror, host-calling demo and inspector
source modules **before bundling**, and writes a separate demo artifact in
`/tmp/opencode/98-instrumented-dist` (preview with `DEMO_BASE=/kalada/` on
port 4199). The same script makes independent unmodified-source and injected
public LS browser bundles for the 50-document cohort. All injection anchors
require exactly one match; the test checks reviewed A source boundaries.
This is not a production patch or a cached parser.

With npm `@playwright/cli@0.1.21` and managed Chromium `154.0.8037.0`:

```
node scripts/browser-bench/98-build.mjs
node scripts/browser-bench/98-stage-run.mjs 20
node scripts/browser-bench/98-fifty-run.mjs
```

Run from `trees/98-measurement`; the A artifact, both loopback previews,
and pinned CLI install (`npm ci` under `scripts/browser-bench`) are prerequisites.
The runners reject browser drift, output parity failures and, for the editor
cohort, off-loopback requests. Evidence: [editor raw samples](98-stage-raw.jsonl)
(`2ef3195bd6fd7538e067f0fd4c3780fe1f7aae4e77dccd5f5cbf105a5b2febb9`)
and [50-document raw samples](98-fifty-raw.jsonl)
(`39912d3b7cb87b6f20b85d90d14deb807caecc01300ee88ccf0ac23ac15e08dc`).
Editor output, decoration spans, diagnostics and inspector JSON are hashed in
persisted evidence *after* full before/after comparison; raw stage event
durations and timing offsets remain in the artifact. Synthetic source only.

## One active demo editor: 20 paired sessions per shape

Each pair reloads the unmodified A and instrumented A separately, prepares the
same document, clears trace events, appends one space, and observes 230 ms.
All **80/80** pairs match before/after text, output, status, highlighted DOM
span classes/text, diagnostics and inspector serialization. Default demo is
`WORKSPACE_READY`; no unsupported 50-editor demo claim. For every edit at
version 3, syntax parse counts are **inspector 2, highlight 1, diagnostics 1,
prepared 1** (5 total); lex counts are also 5. Completion/hover were not
requested in this cohort. Both inspector renders read the same version/text.

Medians in ms (browser `performance.now()` resolution approximately 0.1 ms):

| Fixture | Unmodified / traced dispatch | Parse / lex *per call* | Decoration | Inspector serialization *per render* | Render *per call* | Diagnostics | Prepare | Diagnostics / prepare start offset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typical, 15 UTF-16 | 1.0 / 1.1 | 0 / 0 | 0.1 | 0 | 0.6 | 1.4 | 1.4 | 10.9 / 150.4 |
| token-heavy, 171 UTF-16 | 2.0 / 2.0 | 0.1 / 0.1 | 0.3 | 0.2 | 1.5 | 2.1 | 2.1 | 18.6 / 150.3 |
| recovery, 206 UTF-16 | 2.0 / 2.1 | 0.1 / 0 | 0.3 | 0.2 | 1.4 | 0.2 | 0.2 | 19.5 / 150.4 |
| CRLF/astral, 7 UTF-16 | 1.0 / 1.0 | 0 / 0 | 0.1 | 0 | 0.5 | 1.3 | 1.3 | 8.1 / 150.4 |

One document update and one line-index creation were observed per edit, both
at or below the timer's single-call resolution (median 0 ms). One highlight
classification likewise measured median 0 ms. Successful fixtures evaluate
once (typical median 0.1 ms); malformed recovery does not evaluate. Decorate
includes highlight request and construction, not only `Decoration.set`.
Render includes inspector parse/serialization and DOM construction; it is
*not* a paint timestamp. Diagnostics includes its syntax parse plus compile
and link; prepare likewise includes its own parse plus compile/link. Parse
includes lex, so exclusive parser time is `parse - lex` **within each event**;
do not add nested durations, or sum different stage medians. The inspector
serialization includes its own parse; render includes inspector serialization.
The requestAnimationFrame offset is not paint completion.

The measured dispatch difference is between 0 and 0.1 ms at the median;
that is **not** a zero-cost instrumentation proof. A is always run before the
traced artifact inside one browser session; cache, JIT and frame scheduling
can bias comparisons. Instrumented stage times are not A1-B-A2 latency
samples. The trace retains event metadata only, not CSTs or sources.

## Fifty public-LS documents: 20 runs per shape

Fifty unique synthetic URI/expression pairs per run, each opened at version 1;
one document is edited to version 2. Normal and injected source builds compare
full returned highlight spans, diagnostic codes, status/version/environment
identity, optional completion and hover, and currentness of old snapshots.
All **40/40** runs match; the valid binding-free arithmetic environment
produces **no diagnostics**. Two expression shapes: `1 + i` and
`1 + 1 + ... + i` (40 extra additions). This is *not* an FSX source test or
an application-level 50-editor run.

One run has 50 version-1 line indexes and one version-2 replacement/index;
151 highlight, 151 diagnostics, and 151 analyze syntax parses, plus one
completion and one hover syntax parse at version 2: **455 total**. For each
caller, version 1 receives 148 parses (cold 50, repeat 49, equivalent-env
generation 49); version 2 receives 3 (edited, repeat, equivalent-env).
Neither `openDocument` nor `updateDocument` parses syntax by itself.

| Shape | Normal / traced median 50-doc repeat (ms) | Normal / traced median equivalent-env-generation + analysis (ms) |
| --- | --- | --- |
| arithmetic | 7.8 / 8.0 | 7.8 / 8.1 |
| token-heavy arithmetic | 72.7 / 74.1 | 73.1 / 74.0 |

Opening 50 documents and updating one version both measured at or below
0.1 ms median at browser timer resolution; see per-run samples for variation.
The `repeat` phase makes requests but changes no data. The `envOnly` phase
increments generation with the **same** environment description. Public LS
does not expose a runtime-data update, and this harness does not construct a
new schema; **50-document data and schema updates are unsupported and not
measured**. These two phases must not be reported as data/schema timings.
Cold open plus analysis durations are captured per caller in the raw samples,
not inferred from the open-only median.

## Decision (stop gate)

**NO-GO on B for now.** Same-version duplicate full parses exist: a potential
demo-only inspector memo keyed by document identity/source and reveal policy
could eliminate **one of the two inspector parses per edit** in this tested
sequence. Cross-consumer LS/host sharing could theoretically avoid additional
parses, but host fingerprint/diagnostic semantics, cancellation and separate
bundling make that a larger-risk change. With token-heavy measured parses at
approximately 0.1 ms each (at the timer limit) against about 2 ms unmodified
dispatch and about 1.5 ms inclusive render, a material end-user win from
either change is not demonstrated. No production B should be selected solely
from parse counts. The probe cannot quantify heap bytes per CST; five parse
results are produced per editor edit but no cache retains them, so retained
duplicate-CST memory and allocation savings remain **unknown**, not 5×.
No incremental parsing, throughput SLO, paint guarantee or FSX claim follows
from this trace.

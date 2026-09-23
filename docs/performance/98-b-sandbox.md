# #98 experimental B: instance-owned LS syntax sharing (not release approval)

## Immutable sources and isolation

- A1/A2: unmodified PR #97 `78d624f536d73db5ae813de5f64d8bd52fa07b29`, detached `trees/98-a-readonly`.
- B: experimental branch `feature/98-b-parse-sharing`, `282dad33194615c076e349f5acab47e4a5292745`, based on that exact A commit.
- CLI tooling: PR #100 `376a2c91eb5265706b6572439ebd95b74f7adb7a`, extended separately on `feature/98-measurement` (previous tooling head `e958f914a65845a7d3d968a4c6a616ce093b43eb`).
- npm `@playwright/cli@0.1.21`, managed headless Chromium `154.0.8037.0`, same machine, viewport, CLI config, no CPU throttling. One new, non-persistent CLI browser session per batch; one warmup plus 20 valid sessions per A1, B, A2 cohort. These are *not* paint or SLO timings.

The editor uses the #99 **programmatic trailing space plus `selection: {anchor: from+1}`** operation, *not* the earlier #98 attribution trace's selection-free dispatch. Each session loads five fixture shapes and checks status/output/text, keyboard typing, rapid supersession, source cap and browser version. A1 and A2 use byte-identical A assets; B is unmodified production Vite output from B source. No instrumented build enters these timing cohorts. A ran first and last, but order was not reversed; warm cache/JIT/system drift remains possible.

Editor HTML SHA-256 A: `ddabee1b75f3f4e552d216c44bf76857ba5ab97284e426c7b2b0481511c552fc`; B: `1d7e15e34b7bc8a50c1c5f0e787e8b4dbf1cca8a1566ce205112275721a0d2d9`. Editor entry JS SHA-256 A: `f2fb507ba62ca6b6b427a669ec7200d5b8b08195ae5967313fd3dd6d104800fd`; B: `440994eda00ee7054ecf8998653be0578ac76ba7dafff5c4e6cdf954ba183212`. Fifty-document Vite source bundle SHA-256 A: `b8b5eb19bf0859d7430769fc27b8f6269bdcb3c2dda07e8d13e60a4488861a6a`; B: `03a5ff98e479683ebf3b2338677d99deec8cc5b987e5456776aca092a18a3908`. Fixture hashes, remaining artifact hashes, browser and lock hashes are in the raw cohort manifests.

The 50-source-array SHA-256 hashes in every fresh-session manifest are arithmetic `40f2242a74770225ce5c5abe990d6e0d23c9405d8958497b61f2efede6bb749f` and token-heavy `39dcdc2a3f287b5b73eabff113dc05eb0de74ad8b84f2ceecaccb5099ce8e037`. A/B `bun.lock` SHA-256 is `3dcc9bd69f80040eb6192d0699c977c8db8c2a2c2b16c066277959c66637f5a5`.

## One-active-editor A1-B-A2

Each cell is **median / p95 / IQR** milliseconds for 20 post-warmup dispatch samples. Outlier count (Tukey 1.5×IQR) is in parentheses. All 63 sessions passed, with matching output/text/status/marked text across cohorts. Instrumented A and B additionally matched full DOM span/inspector snapshot digests on four shapes, 20 pairs each.

| Fixture | A1 | B | A2 |
| --- | --- | --- | --- |
| typical | 7.90 / 8.60 / 0.30 (2) | 7.95 / 8.30 / 0.30 (1) | 7.95 / 8.70 / 0.40 (1) |
| many-tokens | 17.40 / 18.20 / 0.60 (0) | 17.60 / 19.10 / 0.90 (1) | 17.50 / 18.20 / 0.50 (1) |
| padded-valid | 8.55 / 9.10 / 0.60 (0) | 8.60 / 9.70 / 0.60 (2) | 8.50 / 9.70 / 0.50 (2) |
| recovery | 17.45 / 18.30 / 0.80 (0) | 17.20 / 18.30 / 0.70 (1) | 17.50 / 18.30 / 1.00 (0) |
| CRLF/astral | 6.90 / 7.20 / 0.20 (0) | 7.05 / 7.60 / 0.20 (3) | 7.15 / 8.40 / 0.80 (1) |

Many-token median B 17.60 ms versus A1 17.40 and A2 17.50: no edit-dispatch improvement. A2 minus A1 is +0.10 ms here; CRLF/astral A2 drift is +0.25 ms. Do not interpret an isolated recovery B median as a speedup. rAF boundary/long-task samples are in the raw files, not a paint measurement. [A1 editor raw](98-b-editor-a1-raw.jsonl), [B editor raw](98-b-editor-b-raw.jsonl), [A2 editor raw](98-b-editor-a2-raw.jsonl).

## Fifty independent public-LS documents

Two valid, binding-free arithmetic shapes (`1 + i`, and `1` plus 40 additions plus `i`); these are synthetic workload proxies, **not FSX**. No demo import above its 16-file cap. The harness serves an otherwise empty same-origin HTML document; there is no demo editor/render running during LS measurements. It opens 50 distinct URIs, requests highlight/diagnostics/analyze cold, edits one version, makes one completion and hover request, repeats the same-document requests, then increments environment generation with an *equivalent description*. Actual runtime data and schema changes **are not exposed by this LS harness and are unknown**. Cold opens and one-file updates are measured separately from parse calls; full per-call cold arrays are retained.

Every cohort: 21 fresh CLI sessions, warmup + 20 valid runs per shape. Full result-spans/diagnostic/status/version/environment signatures, tooling outputs, and stale/currentness states are identical across 60 valid sessions and both shapes; all diagnostics arrays are empty. Each cell below is **median / p95 / IQR**, ms (Tukey outliers in parentheses):

| Phase/shape | A1 | B | A2 |
| --- | --- | --- | --- |
| repeated 50, arithmetic | 9.55 / 10.00 / 0.60 (0) | 9.30 / 10.10 / 0.80 (0) | 9.40 / 9.90 / 0.30 (1) |
| repeated 50, token-heavy | 78.60 / 81.60 / 1.90 (0) | 77.50 / 81.20 / 2.90 (1) | 79.05 / 82.80 / 3.10 (0) |
| equivalent-env 50, arithmetic | 9.15 / 9.80 / 0.50 (0) | 9.10 / 10.30 / 0.60 (1) | 9.45 / 10.10 / 0.40 (1) |
| equivalent-env 50, token-heavy | 74.60 / 77.60 / 2.80 (1) | 74.70 / 76.90 / 3.50 (0) | 76.20 / 79.90 / 3.50 (0) |

Cold 50-document opening: arithmetic median 0.2 ms all cohorts; token-heavy A1/B/A2 0.2/0.1/0.2 ms, without analysis. One-file update: arithmetic median A1/B/A2 ~0.2 ms each; token-heavy approximately 0–0.05 ms at timer resolution. Repeated token-heavy B is ~1.33 ms lower than the midpoint of A1/A2 (~1.7%) under this synthetic workload, but its IQR is wider (2.9 ms versus A1 1.9 ms). The equivalent-env phase has A2-A1 **+1.60 ms drift**, so it does not support a B win; arithmetic repeats are ~0.18 ms lower than A midpoint, near jitter scale. A2-A1 drift token-heavy repeat is +0.45 ms. This does **not** imply an end-user editor speedup or production recommendation.

Cold token-heavy **50 highlight calls** summed within each session (median across sessions): A1/B/A2 **2.50/2.65/2.40 ms**; same-version repeat: **2.20/0.60/2.30 ms**. Cold misses therefore do not improve. The repeated 50 diagnostics-call sums are **38.50/38.90/38.50 ms** and analyze-call sums **38.25/38.30/38.00 ms**: neither consumes the shared syntax parse. The totals for each caller are measured per session before taking medians, not computed by adding per-call medians. They are inclusive stage timings and must not be added to the phase totals.

[A1 50 raw](98-b-fifty-a1-raw.jsonl), [B 50 raw](98-b-fifty-b-raw.jsonl), [A2 50 raw](98-b-fifty-a2-raw.jsonl).

## Actual parse counts, cache cost and limitations

Separate source-injected A/B cohorts agree with their respective unmodified artifacts. One **changed-version editor edit** still performs **5** parses in both A and B (inspector twice, highlight once, host diagnostics once, host preparation once). The LS cache avoids no first parse for a new version; host/inspector paths remain independent. [B editor attribution/parity](98-b-stage-raw.jsonl) versus [A attribution/parity](98-stage-raw.jsonl). Nested timings are not additive.

For one complete 50-document public-LS run, A makes **455** syntax parses: 151 each highlight/diagnostics/analyze plus one completion and one hover. B makes **353**: 51 highlight, 151 diagnostics, 151 analyze, **zero** primary-document completion/hover parses. Thus **102 full syntax parses avoided**, with **51 misses and 102 hits** at the current-version LS cache. B leaves candidate-prefix parses, host diagnostics/analysis and prepared runtime untouched. [B instrumented 50 counts and paired output parity](98-b-fifty-instrumented-raw.jsonl) versus [A instrumented 50 counts](98-fifty-raw.jsonl). Both instrumented/unmodified pairs pass 40/40 parity checks; those instrumented timings were excluded from A1-B-A2.

B's per-instance cache retains at most **one frozen default-limits parse per current URI**, at most **64 URIs**, under an admission/eviction budget of **2,097,152 estimated bytes** (`8192 + 16 × UTF-16 source length` per URI). Tested 50-doc source-size proxy is **414,256 bytes arithmetic or 542,256 bytes token-heavy after one edit**, with no capacity eviction; a >64-doc test and a three-near-limit-doc test force eviction. These numbers are *estimates used for admission*, not measured JS heap or CST allocation. The cache retains a parsed result (and snapshot reference) per admitted open document; actual retained heap, GC and long-lived memory pressure remain unmeasured. No LS `dispose` method exists; close and successful update evict, and stale captures bypass admission. No environment-dependent graph, diagnostics, compile/link, source candidate or inspector output is cached.

## Reproduce and decision

From `trees/98-measurement` (after frozen A/B builds, both previews and `npm ci` for pinned CLI):

```
node scripts/browser-bench/runner.mjs --batches=21 --cohort=A1 --sha=78d624f536d73db5ae813de5f64d8bd52fa07b29 --source=/home/sprawl/projects/kalada/trees/98-a-readonly --artifact=/home/sprawl/projects/kalada/trees/98-a-readonly/apps/demo/dist --url=http://127.0.0.1:4179/kalada/ --out=/tmp/opencode/98-a1-editor.json
node scripts/browser-bench/runner.mjs --batches=21 --cohort=B --sha=282dad33194615c076e349f5acab47e4a5292745 --source=/home/sprawl/projects/kalada/trees/98-b-parse-sharing --artifact=/home/sprawl/projects/kalada/trees/98-b-parse-sharing/apps/demo/dist --url=http://127.0.0.1:4201/kalada/ --out=/tmp/opencode/98-b-editor.json
node scripts/browser-bench/runner.mjs --batches=21 --cohort=A2 --sha=78d624f536d73db5ae813de5f64d8bd52fa07b29 --source=/home/sprawl/projects/kalada/trees/98-a-readonly --artifact=/home/sprawl/projects/kalada/trees/98-a-readonly/apps/demo/dist --url=http://127.0.0.1:4179/kalada/ --out=/tmp/opencode/98-a2-editor.json
KALADA_98_NORMAL_ONLY=1 KALADA_98_OUT=/tmp/opencode/98-a-ls-normal node scripts/browser-bench/98-build.mjs
KALADA_98_NORMAL_ONLY=1 KALADA_98_SOURCE=/home/sprawl/projects/kalada/trees/98-b-parse-sharing KALADA_98_OUT=/tmp/opencode/98-b-ls-normal node scripts/browser-bench/98-build.mjs
node scripts/browser-bench/98-fresh-fifty-run.mjs A1 /home/sprawl/projects/kalada/trees/98-a-readonly 78d624f536d73db5ae813de5f64d8bd52fa07b29 /tmp/opencode/98-a-ls-normal/98-fifty-normal.js
node scripts/browser-bench/98-fresh-fifty-run.mjs B /home/sprawl/projects/kalada/trees/98-b-parse-sharing 282dad33194615c076e349f5acab47e4a5292745 /tmp/opencode/98-b-ls-normal/98-fifty-normal.js
node scripts/browser-bench/98-fresh-fifty-run.mjs A2 /home/sprawl/projects/kalada/trees/98-a-readonly 78d624f536d73db5ae813de5f64d8bd52fa07b29 /tmp/opencode/98-a-ls-normal/98-fifty-normal.js
node scripts/browser-bench/98-b-report.mjs
```

**NO-GO for production B now.** The bounded experiment proves same-version LS parse elimination and a modest 50-document token-heavy benefit, but the primary one-active-editor dispatch is neutral/slightly worse, the heap footprint is estimated rather than measured, and the A1-B-A2 run was not order-reversed. #97/#100 remain pending and B requires independent audit and Builder release-worthiness decision. No PR, merge, SLO, FSX claim or production-implemented status is warranted.

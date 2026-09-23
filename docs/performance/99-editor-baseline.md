# #99: provisional A-only editor baseline

This is measurement tooling for #87, not an optimization (#98) or a production SLO. Candidate A is the **unmerged** PR #97 head `78d624f536d73db5ae813de5f64d8bd52fa07b29`; base `b694fa654938392d7f01367f7ac3d31278ce2d51`. Before *each* collection, the runner checks the live PR head via `gh api`, the source worktree HEAD/clean tracked state, and the HTTP response hashes of index + three assets against the production artifact. A changed PR requires a new cohort; do not relabel these results. No Pages deployment or source code was changed.

## Reproduce

From the #99 worktree, with the PR #97 worktree read-only except ignored build outputs:

```sh
npm ci --prefix scripts/browser-bench
scripts/browser-bench/node_modules/.bin/playwright-cli install-browser chromium
bun install --frozen-lockfile # here and separately in the #97 worktree
bun run build            # in the #97 worktree only
bun run --filter @kalada/demo preview --host 127.0.0.1 --port 4179 --strictPort # #97 worktree
node scripts/browser-bench/runner.mjs --batches=21 --out=docs/performance/99-a-raw.json
node scripts/browser-bench/runner.mjs --batches=21 --out=docs/performance/99-a-confirm-raw.json
node scripts/browser-bench/summarize.mjs docs/performance/99-a-raw.json docs/performance/99-a-summary.json
node scripts/browser-bench/summarize.mjs docs/performance/99-a-confirm-raw.json docs/performance/99-a-confirm-summary.json
```

The runner calls the pinned npm CLI `-s=<unique-session> open <url> --config scripts/browser-bench/cli.config.json`, `-s=<session> run-code --filename=/tmp/kalada-99-*.js`, `-s=<session> requests --static`, `-s=<session> close`. Exact CLI open/requests/close output is preserved per batch in the raw JSON; run-code stdout is losslessly gzip+base64 encoded in `runLogGzipBase64` (decode with `Buffer.from(value, 'base64')` and `gunzipSync`). Each batch is a fresh non-persistent browser session; fixture navigations inside it are warm-cache. One warmup batch is excluded **per cohort**. No forced GC, no throttling, 230 ms settling before/after edit; the latter includes the 150 ms runtime debounce. Run-code executes the five edits in the page (CLI IPC is not timed). Actual `page.keyboard.press('Space')` and rapid two-revision supersession are independent correctness checks, not timing observations. The default loopback origin is enforced and external requests aborted; network request URLs are saved in raw.

CLI 0.1.21 (isolated npm lock, not repository Playwright 1.63); managed Chromium headless shell revision 1246, executable `~/.cache/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell`, Google Chrome for Testing 154.0.8037.0. Linux 7.1.9-arch1-2 x64, Ryzen 7 9800X3D, Node 24.21.0, Bun 1.4.2, `en-US`, Europe/Stockholm; CLI default viewport (recorded per batch), no emulation. The raw manifest includes the exact synthetic text, SHA-256, UTF-16 lengths, lexer token/trivia counts and caps, fixture output signatures, artifact/lock hashes, OS/CPU, session policy, timing samples, failures and request logs. The near-limit whitespace-padded *valid* case is 60,014 UTF-16 units including 60,000 trailing spaces, under the demo's 65,536-character cap. The many-token case has 83 nontrivia lexer tokens, below syntax depth 64 and token 20,000 limits. Recovery has diagnostics rather than a valid output; neither is conflated with a cap fast-path. CRLF and an astral codepoint are present in the final fixture. Syntax-limit diagnostics abort collection.

## End-to-end A observations (ms)

Each cell is median / nearest-rank p95 / IQR, from 20 independent valid batches after one warmup. `dispatch` is synchronous JS from just before CodeMirror dispatch to return; `rAF` is the first callback boundary after start, **not** measured paint/compositor latency or total CPU. Spread and per-batch long-task data are in the summaries and raw files; 0 supported long tasks over measured edits. No timing threshold is asserted.

| Fixture | A dispatch | A rAF | confirm dispatch | confirm rAF |
| --- | --- | --- | --- | --- |
| typical | 7.9 / 8.3 / 0.3 | 11.0 / 17.8 / 0.6 | 7.9 / 8.6 / 0.3 | 11.3 / 17.4 / 5.2 |
| many-tokens | 17.7 / 20.6 / 0.6 | 22.6 / 26.6 / 1.2 | 17.7 / 18.9 / 0.9 | 22.4 / 24.2 / 1.0 |
| padded-valid | 8.5 / 9.3 / 0.3 | 17.2 / 23.4 / 3.5 | 8.7 / 9.3 / 0.5 | 17.4 / 23.8 / 1.7 |
| recovery | 17.2 / 19.4 / 0.6 | 20.9 / 24.0 / 0.8 | 17.2 / 18.0 / 0.7 | 20.8 / 21.7 / 0.8 |
| CRLF/astral | 7.0 / 8.3 / 0.4 | 10.4 / 18.7 / 1.5 | 7.0 / 7.7 / 0.5 | 10.4 / 18.3 / 1.9 |

Raw: [`99-a-raw.json`](99-a-raw.json), [`99-a-confirm-raw.json`](99-a-confirm-raw.json). Derived: [`99-a-summary.json`](99-a-summary.json), [`99-a-confirm-summary.json`](99-a-confirm-summary.json). Both cohorts: 21 sessions, 1 warmup, 20 valid, 0 failed; actual keyboard + supersession passed in all. A rAF spread/dispersion (especially padded case) varies across cohorts; these are descriptive, not regression budgets.

## Future B

`node scripts/browser-bench/compare.mjs A_URL A_DIST A_SOURCE A_SHA B_URL B_DIST B_SOURCE B_SHA OUTPUT_PREFIX` runs 21 fresh sessions for each of **A1–B–A2** on two separately served, loopback-only immutable production builds. It checks per-fixture output/status/document hashes and 20 valid batches in each cohort before printing descriptive ratios of A2/A1 medians. Review drift and spread before comparing B; the runner rejects a moved PR head or mismatched served artifact. Both legs use the same uninstrumented CLI procedure. B is not yet built or measured (#98 deferred).

**Attribution limitation:** No instrumentation-only fork was built. CLI trace does not expose line-index/lex/parse/classify/decorations/inspector/diagnostics/150 ms preparation CPU or parse counts. These remain **unknown**; no stage times, total CPU, or instrumented overhead/equivalence claim is made. CodeMirror DOM access via `cmTile.view` is private and must be revalidated if CodeMirror changes. Editor version is not externally exposed by the production UI: document text/hash, rendered output/diagnostic codes, ready status and visible marked DOM text hashes were recorded, but a version counter was **not** verified. Long-document marked DOM is virtualized, so its hash cannot prove whole-document markup correctness. Future #87 work can add instrumented attribution in a separate fork if needed; not in production #97.

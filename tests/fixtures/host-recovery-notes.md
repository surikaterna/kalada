# #131 CF01 bounded recovery evidence (test-local)

Base `origin/main` 9b3ea643 (#128 merged); Bun 1.4.2, Vitest 5.0.1.
Declared grammar is `[🚀 CRLF]host{guest}next{guest}TAIL`, where TAIL is
brace-free. The guest reports its lexical stop; only `outer-brace` at an actual
`}` plus the exact `}next{` connector permits the second attempt. This is not
an FSX host, a public API, or a full CF01 pass. The integrated recognizer is
independent of the delegated guest implementation, but covers **only** tiny
ASCII decimal additions and this exact two-slot host frame. Neither path
publishes or lowers expressions; `ranges` are candidate admitted ownership,
not authorization to emit a whole document. `attempts` retain diagnostic
codes and absolute UTF-16 ranges, separate from admitted ranges.

| Fixture | Delegated tiny vs integrated tiny: status / last trusted stop / admitted guest ranges / diagnostic & sibling entry |
| --- | --- |
| `host{12 + 34}next{5}TAIL` | equal: valid / 19 / both / none, slots 1+2 |
| `🚀\r\nhost{ 12 }next{3\t+\t4}TAIL` | equal: valid / closing brace slot 2 / both / none, slots 1+2 (UTF-16 prefix) |
| `host{12}next{3 + }TAIL` | equal: partial / slot 2 close / only slot 1 / `TINY_EXPECTED_DECIMAL` at slot 2 close, slots 1+2 |
| `host{12}next{3 + ` | equal: partial / slot 1 close / only slot 1 / `TINY_EXPECTED_DECIMAL` at EOF of slot 2, slots 1+2 |
| `host{12 + }next{3}TAIL` | equal: partial / slot 2 close / only slot 2 / `TINY_EXPECTED_DECIMAL` at slot 1 close, slots 1+2 |
| `🚀\r\nhost{12 + }next{3}TAIL` | equal: partial / slot 2 close / only slot 2 / same diagnostic with UTF-16 offset, slots 1+2 |
| `host{12}next{3}TAIL{broken` | equal: partial / slot 2 close / both islands (not whole host) / none, slots 1+2; no tail range |

Tests assert exact statuses, stops, owner-tagged ranges, diagnostic
codes/ranges and slot-entry arrays against the independent recognizer, rather
than inferring parity from this table. No observed divergence for the seven
shared vectors. Tiny does **not** support Kalada identifiers, quoted braces,
comments or nested braces: the four explicit unsupported tiny vectors reject
at slot 1 and do not enter slot 2; they are **not** evidence of Kalada/tiny
grammar parity. Kalada-specific positive quoted brace and malformed-first
`a + }` vectors, incomplete second, unsafe close/unterminated quote, wrong
connector, stale/cancelled/non-progress and shared work/depth/diagnostic
exhaustion are checked separately. Unsupported brace syntax is rejected even
if the Kalada guest reports an `outer-brace` stop with an unsupported-form
diagnostic. Host tail with an extra `{` is not inferred as valid text.
Both host connector and tail are charged one UTF-16 unit before each read.
At work limit 16, a million-character brace-free tail and a tail with a brace
only at the millionth character both stop at budget (work 16, stop 13, no
admitted ranges), rather than classifying the unchecked suffix. Connector
exhaustion prevents sibling entry. Short `TAIL` with a CRLF/astral prefix
remains valid on an exact shared work budget. The independently implemented
integrated tiny recognizer has no meter: the seven-vector comparison excludes
budget exhaustion and makes no claim of parity on low-budget inputs.

Commands from this worktree after `bun install --frozen-lockfile` (pass):

- `bunx vitest run tests/host-recovery.test.ts tests/integrated-tiny-recovery.test.ts` — 25/25 tests pass.
- `bun run lint` — pass (373 files).
- `bun run typecheck` — pass (all workspaces). Initial attempt failed due to
  missing `@scheman/core` and `vite/client` before frozen install; rerun passed.
- `bun run test` — pass, 79 files / 929 tests.
- `bun run build` — pass (demo size warning only).
- `bun run syntax:smoke` — pass, packed syntax smoke (includes build).
- `git diff --check` and `git diff --no-index --check /dev/null <file>`
  for each of five untracked files — pass.

Limits: Meter and callbacks are cooperative test fixtures, not isolation from
hostile guest code. The tiny recognizer is not a full lexical host parser.
No general nested/alternating grammar or production FSX behavior is claimed.
Phase admission, provenance, safe publication/edit behavior and production
integration remain for #132 / parent #108. No publishable package changed;
no changeset is appropriate.

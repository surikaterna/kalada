# #146 CF01 public-path reconciliation (base `06014ef`, contract v1)

Owner decision A: **first FSX host → Kalada Expressions**. This forward
parser-only evidence is **INDEPENDENTLY VERIFIED, NOT MERGED/PUBLISHED** (pending
PR review); it does not assert a real FSX consumer or
Formbar #179/#183 signoff. Actual Kalada Expressions host → FSX fragments is
**DEFERRED to #153**; documentation staging is #154 after #146. Full CF01
acceptance and parent #108 remain **OPEN**.

Test: `bunx vitest run tests/cf01-public-reconciliation.test.ts` (11 passing).
Imports are the **package exports** of `@kalada/provider-routing` and
`@kalada/syntax`, not their source modules. The neutral `host{…}next{…}TAIL`
grammar in the test declares its openings and validates its literal `next`
connector after the returned close; it never scans a Kalada guest interior.
The tiny decimal-addition guest is independently authored, and has no
Expressions/kernel dependency. #145 packed node/browser consumer proof still
passes: domain-only graph contains only provider-routing 0.1.0; opt-in graph
contains provider-routing 0.1.0, syntax 0.1.0 → core 0.6.0, host and LS.
No release publish or FSX consumer is claimed here.

## Supported grammar and lexical boundary (version: syntax 0.1.0, CF01 v1)

| Input at declared Kalada entry | Result / owner | Boundary |
| --- | --- | --- |
| Numeric literals, arithmetic and parenthesized operators (`1 + (2 * 3)`), quoted `}` (`"}"`), supported strings and references | Kalada guest syntax; outer `{` and `}` remain host-owned | Positive original-source UTF-16 ranges after `🚀\r\n`; valid parse and real lowering separately checked. Syntax-valid need not be lowerable. |
| `1 + ` before a lexed outer `}` | Partial with parser diagnostic and `safe-host-close`; host validates `}` plus `next` | Failed attempt only; independent second valid guest appears in `candidates`, not `tree`. No lower/emit/edit. |
| `//`, `/*`, single quote, unterminated double quote, nested `{` | Unsupported/partial, never safe recovery | Even if prefix reports `outer-brace` for unsupported `{`, `KALADA_SYNTAX_UNSUPPORTED_FORM` forbids lexical-safe continuation. No search ahead to sibling. |
| EOF without a close, unmatched parentheses | Partial; no certified host close | No whole tree or sibling authority. |
| Tiny ASCII decimal additions with spaces/tabs | Independent guest via same public router | No Kalada syntax/core import in the tiny guest. Not a grammar extension for Kalada. |

`parseGuestExpressionPrefix` can report `outer-brace` *and* unsupported-form
diagnostics when it encounters `{`. The adapter explicitly checks diagnostics
before certifying a lexical-safe close; an `outer-brace` reason alone does not
prove recovery. No general hostile plugin isolation, comment lexing, nested
braces, arbitrary JS sandbox or backwards grammar inferred from this fixture.

## Integrated vs delegated tiny: seven actual vector outcomes

Integrated comparator is `integratedTinyRecovery`, the pre-existing test-local
whole-document decimal recognizer; delegated uses **public** router. Both use
half-open original UTF-16 offsets. Table gives integrated/delegated status,
guest stop(s) from integrated attempts (delegated failed attempts and successful
tree/candidate ranges match where exposed), and diagnostic positions.

| Source | Status I / D | Stops I (UTF-16) | Diagnostics I / D | Difference |
| --- | --- | --- | --- | --- |
| `host{1}next{2}TAIL` | valid / valid | 6, 13 | none / none | Integrated host/guest ranges and public tree guest ranges agree. |
| `host{1 + }next{2}TAIL` | partial / partial | 9, 16 | `TINY_EXPECTED_DECIMAL` [9,9) / same | Public first failed attempt and second candidate; no tree. |
| `🚀\r\nhost{1 + }next{2}TAIL` | partial / partial | 13, 20 | `TINY_EXPECTED_DECIMAL` [13,13) / same | Astral and CRLF shift offsets by four UTF-16 units; no normalization. |
| `host{1}next{2 + 3}TAIL` | valid / valid | 6, 17 | none / none | Public tree has two guest ranges. |
| `host{1}next{2 + }TAIL` | partial / partial | 6, 16 | `TINY_EXPECTED_DECIMAL` [16,16) / same | Integrated retains first valid range; public partial has no whole tree or first valid candidate. |
| `host{1}next{2` | partial / partial | 6, 13 | `TINY_EXPECTED_DECIMAL` [13,13) / same | EOF: no safe second close, no public tree. |
| `host{!}next{2}TAIL` | unsupported / unsupported | 5 | `TINY_EXPECTED_DECIMAL` [5,5) / same | Unsupported token: no safe sibling. |

For the final two vectors, delegated guest parse invocations start at [5,12]
and [5] respectively (two attempts vs one), with diagnostic stop at 13 and
5 respectively. The public outcome does **not** expose `attempts` for an
ordinary second-slot EOF or first-slot unsupported exit; unlike integrated
attempt records, those stops are evidenced by the delegated diagnostics and
measured parse invocations, not fabricated public attempt entries. The
astral/CRLF Kalada partial diagnostic is literally
`KALADA_SYNTAX_EXPECTED_EXPRESSION` [13,13) in original UTF-16 offsets.

The integrated comparator is unmetered; delegated host charges its own
prefix/connector and guest charges tokens into one shared meter. Public partial
outcomes intentionally omit an authoritative tree and do not expose an earlier
valid slot as a candidate when the **second** slot fails. This is an evidence
shape divergence, not equivalent output graphs. Seven vectors are not grammar
equivalence or full lexical recovery proof.

## Phase admission / refusal

Test-local phase sink: captured → public composition valid with a whole tree →
single current Kalada child with authentic in-process parse object → real
`lowerKaladaV1Expression` success → simulated emit/edit counters. Invalid,
partial, stale, cancelled, work/depth over-limit, forged owner/stop/range/reason,
disallowed/ambiguous registration and deserialized CST all record zero
lower/emit/edit; the real lowerer independently rejects JSON-restored CST.
The sink has **no publisher backend**; its in-memory WeakSet only gates this
test, not a durable security/provenance protocol. Diagnostics are guest-owned
original ranges; a failed attempt cannot authorize publication. Existing
`tests/phase-admission.test.ts` supplies the more detailed test-local phase
table and meter mutation cases. The router validates guest ranges and charges
close; the host callback certifies only its own connector.

## Gates and closure limits

`bun install --frozen-lockfile`, focused vitest, `bun run build`,
`bun run typecheck`, `bun run lint`, `bun run test`, `bun run syntax:smoke`,
`bun run syntax:browser-smoke`, `bun run provider-routing:smoke`,
`bun run package:smoke`, and `bun run provider-routing:packed-consumers`
are the gates for this local evidence. No publishable package change, so no
changeset. No exception to code principles requested.

**#108 remains OPEN:** Kalada Expressions grammar has no reverse embedding
host node or approved separate reverse host position/profile, so a real
Kalada-as-host → FSX fragment path is not proved. The neutral host forward
path is not a substitute. Owner A defers reverse grammar and host contract
to #153 rather than modifying the public API under #146. Real Formbar
#179/#183 FSX signoff remains downstream, not a blocker for this parser-only
evidence. No CF01 pass, #141/#108 closure or release PR #63 unblock is
inferred from this test.

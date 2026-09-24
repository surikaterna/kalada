# #132 CF01 phase admission evidence (test-local, not CF01 approval)

Base `origin/main` 7e9e8e3 (#131 merged). Run `bun install --frozen-lockfile`,
`bunx vitest run tests/phase-admission.test.ts tests/host-profile.test.ts tests/host-recovery.test.ts tests/integrated-tiny-recovery.test.ts tests/second-guest.test.ts`.
Version and gate results are recorded in the #132 handoff. No publishable package
changes; no changeset. This is a cooperative synchronous test fixture, not a
public opt-in embedding interface or an FSX host.

The phase table in `phase-admission.ts` is monotonic per request:

| Phase | Evidence required before advancing | Rejection consequence |
| --- | --- | --- |
| captured → selected | source/version/environment match, explicit permitted Kalada profile | no callback/action |
| selected → guest returned | bounded callback returned in declared `host{}` slot | no action |
| guest returned → host validated | current snapshot still matches, not cancelled; actual brace, owner ranges, tail and shared meter validated by `compose` | no action |
| host validated → phase admitted | returned result is the **same object** as this invocation's trusted Kalada guest result; owner range equals its stop | no lower/emit/edit |
| phase admitted → lowerable | real `lowerKaladaV1Expression` succeeds using parse-result identity provenance | no emit/edit on lower failure |
| lowerable → publishable | whole single-slot host valid | test-local emit/edit counters increment |

`parse.ts` stores provenance in a `WeakMap` keyed by the actual parse result;
`lower.ts` rejects a JSON round trip with `KALADA_SYNTAX_INVALID_INPUT` and no
program. Host validation alone is insufficient: a deserialized parsed value
can pass `compose`'s source check, but phase admission blocks it before lowering.
The fixture records `lower`, `emit`, `edit` counters (all zero on admission
rejection). A result admitted for lowering but rejected for publication after
lowering fails records `lower: 1`, `emit: 0`, `edit: 0`; it cannot publish.
The fixture does not actually publish or edit anything. `#131` recovery may
admit one valid sibling into candidate ownership while the whole source is
partial: `phase-admission.test.ts` verifies no whole-document publication.

## Trace to CF01 requirements

| CF01 clause in `docs/architecture/composable-language-conformance.md` | Executable evidence and limit |
| --- | --- |
| 61–71 declared positions, deterministic selection, lexical return and UTF-16 source/trivia | `tests/host-profile.test.ts` (#127), `tests/second-guest.test.ts` (#128), `tests/phase-admission.test.ts` quoted-brace CRLF/astral range and source map; `tests/fixtures/host-profile-notes.md` |
| 72–82 invalid/forbidden selection, unsupported lexing, partial sibling, budget, stale/cancelled and deserialized provenance | `tests/host-profile.test.ts`, `tests/host-recovery.test.ts` (#131), `tests/phase-admission.test.ts` and `tests/fixtures/host-recovery-notes.md`; no general hostile callback isolation |
| 83–85 phase table and integrated/delegated comparison | this table, `tests/integrated-tiny-recovery.test.ts` (#131) and `tests/fixtures/host-recovery-notes.md`; integrated tiny comparator is **unmetered** and covers only ASCII decimal additions |

Supported here: current Kalada expression grammar at a declared one-slot host
position, including quoted `}` and parentheses; the two-slot recovery fixture
uses literal `}next{` and brace-free host tail. Tiny is independent and accepts
only ASCII decimal additions and spaces/tabs in those literal slots. Unsupported
Kalada comments, nested braces and ambiguous unterminated quotes fail closed;
no claim of lexical parity or automatic sibling discovery. The shared Meter
accounts for host bytes, guest bytes, depth and diagnostics across slots;
diagnostic UTF-16 ranges are **attempt** ranges, not admitted owner ranges.
Do not infer lowerability from syntax validity: the positive literal lowers,
whereas incompatible `1 + "x"` can parse and still fail lowering. Tests deliberately
do not require every valid syntax tree to emit.

**Unresolved #108 parent requirement:** equal **public** opt-in path for both
directions is not implemented by test-only #132; CF01 is not passed and #108
must stay open. Coordinate the public-path gap with #111; #102 PR #105 and
#104 PR #106 remain separate open work. The fixture is not a security boundary
for arbitrary plugin code: a hostile callback can loop or mutate the shared
meter; cooperative budgeting cannot provide process isolation. No CF02/CF13,
Formbar #184, production FSX, or API-freeze claim follows from these tests.

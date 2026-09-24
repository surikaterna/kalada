# #128 second guest proof (test-local, not a package API)

Base `origin/main` fac6e65; Bun 1.4.2. `host{...}` declares expression
entry and `tiny<host{...}>` declares a **different**, explicit reverse
host position. The latter permits Kalada in this toy host; it does not mean
Kalada Expressions can parse tiny syntax or host either grammar. Selection
does not enumerate parsers; explicit selection overrides a permitted static
default. The old #127 Kalada vectors still use the same host path through
the Kalada adapter, with their lowering/source-map comparison intact.

`tiny-guest.ts` independently scans ASCII decimal additions (spaces/tabs);
its stops and diagnostic ranges are absolute JavaScript UTF-16 indices. A
strict integrated tiny-host recognizer is compared with delegation for a complete
source and a malformed host sibling: accepted status, stop, ownership and
document-level error presence agree. The integrated recognizer only emits
`MALFORMED_DOCUMENT`, not guest diagnostics. This is **not** a representative
FSX parser. Known divergent/unsupported pairs: Kalada accepts identifiers,
strings, parentheses and conditionals that tiny rejects; tiny does not
support comments, Unicode digits, newlines, or nested braces. Kalada's own
guest rejects comments and braces; an unterminated quote has ambiguous
ownership. Diagnostic-code and recovery parity are unproven.

Tiny-only browser bundle graph command:
`bun build tests/fixtures/tiny-only.ts --target=browser --outfile=/tmp/opencode/kalada-128-tiny.js --metafile=/tmp/opencode/kalada-128-tiny-meta.json`.
The metafile has exactly three inputs: tiny-only, tiny-guest and host-profile;
no @kalada/syntax, core, host or Expressions input. This is a test-local
browser bundle (not a published consumer or runtime dependency graph of a
published package); tree shaking may exclude unused code, but the neutral
fixture has no syntax import even before bundling.

Shared cooperative meter tests cover entry/guest/host continuation work,
depth, diagnostics, exhaustion and spoofed counters/exits. Tiny debits each
scan step before reading the next character; the host reconciles its reported
charge rather than charging those characters twice. Long digits, repeated
additions and nested entries stop at remaining work without host-tail ownership.
Callbacks are
trusted cooperative toys: there is no hard time/memory bound or isolation
for a hostile callback. Remaining #108 CF01 gaps: production host integration,
recursive real guest ownership, robust lexical recovery and sibling handling,
provenance/phase admission and publication, and representative integrated
FSX/Formbar differential evidence. PR105/#102 and PR106/#104 are unmerged;
no production provider-routing assertion is made.

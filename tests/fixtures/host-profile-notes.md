# #127 stacked host-profile probe

Run `bunx vitest run tests/host-profile.test.ts` on `feature/127-host-profile`
stacked on #110 `a170fc3`. This is a test-local one-slot host, **not** a public
embedding API or CF01 pass. `host{expression}` and `🚀\r\nhost{expression}`
are the only declared entries; following brace-free text is host-owned.
Selection is explicit or a permitted static root default. Guest parsing uses
the #110 internal guest-owned stop; no host prescan of the guest interior.

Positive vectors cover currently supported syntax, a quoted brace, parentheses,
CRLF/non-BMP parent UTF-16 offsets, absolute source-map parity for lowerable
expressions, and host continuation. The quoted string-plus-number vector is
syntactically valid but **does not** claim successful semantic lowering.
Negative vectors cover forbidden/default selection, overlap, ambiguous guest,
unsupported comments/braces, malformed strings/groups/siblings, missing close,
invalid exits, stale snapshots/environment and cancellation, and shared
entry/guest/host work, depth, and diagnostic budgets. A nested toy host/guest
callback passes the same mutable meter to a child entry, proving accumulated
work/diagnostics and active depth without adding a second real guest. The
actual Kalada guest remains one-slot; its lexer is bounded on entry by
maxSourceLength/maxDiagnostics. Injected callbacks are cooperative test toys,
not bounded untrusted guests: their return is checked after the call. Failed
outcomes expose no owned valid ranges or publication. A real diagnostic CST is
rejected by the existing lowerer; the helper does not itself lower or emit.

Remaining #108/CF01 gaps (not verified here): real nested alternating islands,
independent second guest and reverse host position (#128); supported comments/
braces, lexical recovery across malformed siblings beyond this fixture's
brace-free tail, representative integrated host comparison, phase/provenance
admission and safe edits/publication. No claim of bounded untrusted injected
guest callbacks or full recursive production parser is made.

# #145 packed parser peers

Run `bun run build && bun scripts/packed-parser-peers-smoke.ts` from the repository root.
The script creates a temporary Changesets version plan, packs the built public artifacts,
and runs two independent offline npm installations outside the workspace. The domain
installation has only the neutral router; the opt-in installation also has syntax and
core. No registry fallback or workspace links are permitted. The tiny lexer is independent
of Kalada; both guests use the same neutral composition contract.

The browser-target bundle runs in a Node VM without Node globals, **not** a real browser.
The registered callbacks are trusted and cooperative; the meter cannot preempt hostile
CPU or memory use. The syntax prefix parser's own bounded limits apply before its scanned
prefix is charged to the router meter; the router does not sandbox that call. A valid
tree only proves syntactic composition, not publication authority, CF01 execution, or
Formbar runtime integration. #146 follows; #108 still needs those separate gates.

# @kalada/provider-routing (experimental)

Two separate opt-in, dependency-free experimental capabilities: whole-document diagnostic
routing and host-owned parser composition. Contract version
`DIAGNOSTIC_CONTRACT_VERSION === 1` identifies this provisional diagnostic shape;
the package is not a stable language kernel API. Changes to the experimental contract
may require consumer updates. There is no implicit Expressions provider: install
`@kalada/language-service` separately to opt into its Expressions adapter.

```ts
import { createDiagnosticRouter } from "@kalada/provider-routing";

const router = createDiagnosticRouter([{
  languageId: "my-language",
  diagnose(document) {
    return { status: "supported", diagnostics: [] };
  },
}]);
const outcome = router.diagnose("my-language", {
  uri: "file:///example.txt",
  text: "hello",
  version: 1,
  environmentGeneration: "schema-1",
});
```

The caller supplies an explicit language ID and whole-document snapshot for each request.
`version` is a nonnegative safe integer document revision; `environmentGeneration` is a
nonempty opaque identity for the caller's environment. The router copies and freezes
the snapshot before invoking a provider. Callers must compare returned document identity
with their *current* document and environment before displaying diagnostics; the router
cannot discover a changed external environment. Duplicate or empty registrations,
unknown language IDs, and malformed document identity throw. Registration reads the
language ID once; providers should be trusted code, not downloaded plugins.

`supported` carries an empty diagnostic list; `invalid` carries one or more diagnostics;
`unsupported` has no diagnostics. Each diagnostic has an uppercase code and a half-open
`[start, end)` UTF-16 offset range within the snapshot (including zero-width ranges).
Malformed provider results become `invalid` with `PROVIDER_INVALID_RESULT`; thrown
provider/accessor errors become `PROVIDER_FAILURE`. Input over 100,000 UTF-16 code units
becomes `PROVIDER_SOURCE_LIMIT` without invoking the provider. At most 100 diagnostics
are accepted; code length is at most 128, and URI/environment identity length at most
2,048 code units. These limits are provisional, not calibrated platform budgets.
Returned diagnostics and snapshots are frozen copies, not live provider values.

`COMPOSITION_CONTRACT_VERSION === 1` identifies the separate provisional host-composition
contract. A trusted host parser supplies **declared** slot offsets (not discovered by the
router), a versioned host-language/grammar-position profile, allowlisted guest IDs and
host-owned opening/closing markers. An explicit guest choice overrides the static profile
default; neither may bypass the allowlist, and no selection means unsupported (no fallback).
For reverse embedding, register a *separate* reverse host profile. The host keeps delimiters;
the selected guest lexes its interior and returns its own opaque subtree, UTF-16 range,
consumed stop, reason and diagnostics. Success requires `status: "valid"`,
  `reason: "host-close"`, a progressing claimed interior, an actual host close at stop, no diagnostics and a subtree;
`reason: "eof"` cannot authorize a tree. The router validates progress, local bounds, closing marker,
ownership (including diagnostic codes/ranges), selection, currentness and cancellation before returning a navigable host/guest
tree. It does not parse the host or know how to skip guest strings/comments: guests must
implement their language's supported lexical boundary themselves and report the **first**
applicable close in their grammar. A host may supply an independently known slot `maxStop`
  to reject a later return; this optional safe UTF-16 offset may equal the interior start
  for an early failure. The router does not scan guest text for earlier `}` (which
might be quoted), nor can it detect a dishonest trusted provider's earlier neutral close
  without such a bound. Bounded `unsupported`, `partial`, and `invalid` returns may stop at
  the opening offset or EOF, even without a closing marker. They retain the guest reason
  and copied owner-tagged diagnostics within `[start, stop]` (including zero-width at stop),
  but do not consume a host close or authorize a sibling. Invalid bounds, owner, status or
  diagnostics fail closed without guest diagnostics. Unsupported, partial, invalid, stale,
  cancelled and budget outcomes have no tree and confer no emission/edit authority.

```ts
import { createCompositionRouter } from "@kalada/provider-routing";
const router = createCompositionRouter([{
  version: 1, hostLanguageId: "host", position: "expression",
  open: "{", close: "}", allowedGuests: ["tiny"], defaultGuest: "tiny",
}], [{ languageId: "tiny", parse({ start, meter }) {
  meter.charge(3); // cooperative guest work, including nested calls
  return { owner: "tiny", status: "valid", range: { start, end: start + 3 },
    stop: start + 3, reason: "host-close", diagnostics: [], subtree: { kind: "tiny" } };
} }]);
const input = { uri: "file:///a", text: "{abc}", version: 1, environmentGeneration: "env" };
const result = router.compose({ snapshot: input, hostLanguageId: "host",
  slots: [{ position: "expression", start: 0 }], isCurrent: () => true,
  limits: { work: 100, depth: 4, diagnostics: 10 } });
```

The router copies/freezes source identity and profile declarations; `isCurrent` must check
the caller's live document **and environment** both before and after callbacks, and consumers
must recheck before publishing. Optional `context` carries host-owned opaque expected-type
and location facts, not type checking or permission to write. Nested compositions must pass
the same meter. Host charges its own text and opening/closing markers once; guests charge
  actual interior work (at least one unit for nonempty successful interior), including nested
  calls, via that meter. Work/depth/diagnostic bounds are cooperative and qualitative, not a CPU or
memory sandbox: never register untrusted executable providers. Guest subtrees and opaque
context values are language/host-owned references, not deep-frozen or admitted artifacts.

This package does **not** implement a host parser, generic AST/CST, type composition,
expression evaluator, editor/LSP services, or CF01 completion (#108). The real Kalada
adapter and independent packed two-guest proof belong to #145.
Packed independent domain and Expressions opt-in cross-consumer proof is tracked by #137.

### Experimental partial recovery (#151)

Optionally pass `hostContinuation: { validate(input) { ... } }` to `compose` for a trusted
host grammar to certify a connector to the **next predeclared slot**. The frozen input
contains the copied snapshot, the guest-reported host `close` range, a frozen copy of the
next slot and the same cooperative meter. After independently validating its own grammar
between `close.end` and `nextSlot.start`, the host charges at least the connector's UTF-16
length and returns `{ owner: hostLanguageId, range: { start: close.end,
end: nextSlot.start } }`. A Boolean, a guessed slot, or scanning a guest interior is not
proof. The router checks the original source's closing/opening markers, profile selection,
bounded offsets, ordering, meter and live snapshot identity before invoking the next guest.

Only a bounded, progressing `status: "partial", reason: "safe-host-close"` guest exit
whose lexed stop points at the actual close can initiate recovery. The guest must account
for its interior work on the shared meter; `invalid`, `unsupported`, EOF or ambiguous
exits cannot resume. On a recovered `partial` outcome, `attempts` contain only failed
guest exits as frozen owner-tagged bounded ranges/reasons/copied diagnostics;
`candidates` contain only opaque language-owned nodes from independently valid siblings.
A fully valid document has a `tree` instead of `attempts` or `candidates`. The failed
subtree is never read. Neither `attempts` nor `candidates` is an authenticated host CST
or the authoritative `tree`;
they grant no lowering, emission, editing or publication authority. Consumers must recheck
source/version/environment identity before displaying even diagnostic recovery data.
No Formbar runtime or CF01 pass is implied; this is trusted cooperative code, not a sandbox.

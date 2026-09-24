# @kalada/provider-routing (experimental)

Opt-in, dependency-free whole-document diagnostic routing. Contract version
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

This package does **not** parse or check source, compose grammars or types, run
expressions, expose editor/LSP services, or supply a public parser handoff (#108).
Packed independent domain and Expressions opt-in cross-consumer proof is tracked by #137.

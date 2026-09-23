# @kalada/language-service

Headless document analysis, diagnostics, completion, hover, UTF-16 coordinate conversion, and
formatting for Kalada.
The package has no editor, transport, filesystem, network, DOM, scheduling, or evaluation behavior.

Create a service with a host `DescribeEnvironmentResult`, then explicitly open and version documents.
Document versions and environment generations are non-negative safe integers and must increase. A URI
is an opaque, non-empty string. Closing a document does not reset its version high-water mark.

All edits are validated against the old immutable snapshot and commit atomically. Public positions
are zero-based UTF-16 code-unit positions. CRLF is one line break; positions inside a line break map
to the preceding line end, and line-end positions map to the first code unit of that break.

Analysis cancellation is checked after capture and environment inspection, before and after host
parse, compile, and link, and just before completion. Formatting checks after capture, formatting,
and just before completion. A cancelled operation returns a typed cancellation result and never
diagnostics. There is no analysis cache. Result `status` is informative at return time; adapters must
call `isCurrent(result)` as their final publication guard.

Analysis composes the public host parse, compile, and link phases. It exposes only the safe syntax,
normalized environment, program, and source map artifacts available at the completed phase. Link
diagnostics are published, but the prepared evaluator is discarded and never exposed or invoked.
Capability snapshots are passed only to host linking; capability callbacks are never invoked.

`completion(uri, position)` and `hover(uri, position)` synchronously capture the same document and
environment identities as analysis. They use parser recovery for incomplete source and query only the
immutable normalized editor graph. Completion edits and hover ranges are UTF-16. Structural input
shape, presence/provenance evidence, and Kalada output semantics remain separate. Unknown graph or
semantic branches stay conditional; runtime values, capability callbacks, and schema-vendor APIs are
never read.

`getWorkspaceSnapshot()` contains only document identities and the environment generation. Documents
share an environment but have no imports, module resolution, or cross-file expression semantics.

### Opt-in Expressions diagnostics routing

`createExpressionsDiagnosticProvider(resolveEnvironment)` returns an `expressions` whole-document
diagnostic provider structurally compatible with the private diagnostic routing prototype. Register
it explicitly alongside independent domain providers; the language service does not register it by
default and does not depend on the private router. The resolver receives each document's string
`environmentGeneration` and must return `{ environmentGeneration, description }`, where
`description` is a host `DescribeEnvironmentResult` for that exact generation. Missing or mismatched
generations yield `EXPRESSIONS_ENVIRONMENT_UNAVAILABLE` and never reuse a prior environment.
Each request creates a fresh language service and runs its existing parse → compile → link diagnostic
pipeline; there is no provider cache, execution, or capability callback invocation.

Routing preserves the input document identity but projects diagnostics to ordered `{ code, range }`
only, with half-open UTF-16 **offsets** (not line/character positions). Phase, message, provenance
and cause are intentionally lost; use `createLanguageService` for full diagnostic evidence.
Diagnostics without a source range (notably environment and some link errors), or with an
unmappable location, use `[0,0)` as **unknown location**, not a claim about source character zero.
Router limits/failures are enforced by the router (100,000 UTF-16 source units and 100 diagnostics);
resolver exceptions are router failures. This is whole-document routing only, not mixed parsing,
LSP, or a stable universal provider API.

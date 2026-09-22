# @kalada/language-service

Headless document analysis, diagnostics, UTF-16 coordinate conversion, and formatting for Kalada.
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

`getWorkspaceSnapshot()` contains only document identities and the environment generation. Documents
share an environment but have no imports, module resolution, or cross-file expression semantics.

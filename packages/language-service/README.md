# @kalada/language-service

Headless document analysis, diagnostics, UTF-16 coordinate conversion, and formatting for Kalada.
The package has no editor, transport, filesystem, network, DOM, scheduling, or evaluation behavior.

Create a service with a host `DescribeEnvironmentResult`, then explicitly open and version documents.
Document versions and environment generations are non-negative safe integers and must increase. A URI
is an opaque, non-empty string. Closing a document does not reset its version high-water mark.

All edits are validated against the old immutable snapshot and commit atomically. Public positions
are zero-based UTF-16 code-unit positions. CRLF is one line break; positions inside a line break map
to the preceding line end, and line-end positions map to the first code unit of that break.

Analysis cancellation is checked after capture, environment inspection, parsing, lowering, and just
before completion. Formatting checks after capture, formatting, and just before completion. A
cancelled operation returns a typed cancellation result and never diagnostics. There is no analysis
cache. Result `status` is informative at return time; adapters must call `isCurrent(result)` as their
final publication guard.

The analysis artifact exposes the exact public syntax result and, on success, normalized environment,
program, and source map. This is the integration boundary for future host linking. Linking is not
available at this package baseline, and the language service never evaluates a program.

`getWorkspaceSnapshot()` contains only document identities and the environment generation. Documents
share an environment but have no imports, module resolution, or cross-file expression semantics.

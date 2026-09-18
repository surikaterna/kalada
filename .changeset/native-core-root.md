---
"@kalada/core": minor
---

Make the native Kalada v1 API the canonical package root. This breaking cleanup removes the
`@kalada/core/kalada-v1` and `@kalada/core/kuery-v1` subpaths and the legacy Kuery adapters from the
root; consumers must import native factories, types, values, and compilation APIs from
`@kalada/core`. Ordinary current-realm Promise rejections are consumed when the captured intrinsic
can attach without observable host interaction; hostile or untrusted Promise candidates remain
synchronously unsupported without getter access, mutation, or a claim that host-owned rejections
were consumed.

---
"@kalada/language-service": patch
---

Avoid repeated syntax parsing across current-document highlight, completion and hover requests while preserving the existing public results and cancellation semantics.

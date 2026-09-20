---
"@kalada/core": minor
---

**BREAKING (pre-stable):** expand `kalada-v1` in place with canonical strict equality, explicit number/string ordered comparison, and array-only deep membership expression variants. Existing programs retain their behavior, but exhaustive TypeScript and strict schema consumers must add the new closed union members before accepting programs that use them.

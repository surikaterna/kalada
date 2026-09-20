---
"@kalada/core": minor
---

**BREAKING (pre-stable):** expand `kalada-v1` in place with strict `field-access` and Option-preserving `optional-field-access` expression nodes. Existing programs remain valid, but public expression unions and schemas gain variants, so exhaustive TypeScript consumers must handle them and old strict consumers cannot accept new programs.

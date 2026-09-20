---
"@kalada/core": minor
---

**BREAKING (pre-stable):** expand the public `kalada-v1` expression union and strict program schemas with canonical `conditional` and `option-coalesce` variants. Existing programs retain their behavior, but exhaustive TypeScript consumers and captured strict decoders must add both closed node forms before accepting programs that use them.

# @kalada/syntax

## 0.1.0

### Minor Changes

- b5ca22c: Add the first browser-safe Kalada v1 syntax package with lossless tokens and CST, bounded parsing and recovery, static source dispatch, canonical lowering and source maps, and an idempotent formatter. Function, call, constructor, match, import, module, and general ADT syntax remain intentionally excluded.
- 4a05c8a: Expose authoritative subtree semantics, add schema-neutral completion and hover, and publish the thin CodeMirror 6 integration.
- f456f6f: Expose an opt-in experimental guest-owned Kalada expression-prefix parse entry for declared host slots, with original-document UTF-16 ranges and bounded handoff before the host delimiter.
- a92f674: Expose syntax-owned lowering result types and add synchronous host compile, link, prepared, and one-shot execution.

### Patch Changes

- a170fc3: Prototype an internal bounded guest-owned expression boundary without changing the public syntax API.
- Updated dependencies [efa9802]
- Updated dependencies [1eaeca5]
- Updated dependencies [ed9c53f]
- Updated dependencies [bf7b6e5]
- Updated dependencies [ef577f0]
  - @kalada/core@0.6.0

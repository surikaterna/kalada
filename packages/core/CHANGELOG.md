# @kalada/core

## 0.4.0

### Minor Changes

- 68d00d8: Add the `kalada-v1` canonical typed-function AST, factories, schemas, static signature checks, lexical capture metadata, dependency traversal, diagnostics, and limits for Kalada #23 (K6-2), parent #6, and Formbar #93. Runtime function execution remains deferred, and module/import hooks from #21 remain excluded.
- bf3257e: Execute typed lexical closures, higher-order calls, and bounded recursion through the iterative `kalada-v1` continuation machine for Kalada #24 (K6-3), parent #6, and Formbar #93. Core collection execution and modules/imports remain deferred.
- 28e743d: Execute bounded `map`, `filter`, `some`, and `every` core-function values through the shared `kalada-v1` callable continuation machine for Kalada #25 (K6-4), parent #6, and Formbar #93. Modules and imports from #21 remain excluded.

## 0.3.0

### Minor Changes

- cfc8981: Add deterministic, safe-integer `Instant` and `Duration` values, typed temporal expressions,
  versioned value envelopes, explicit pre-sampled evaluation input, and an eager sample-once Clock
  boundary. Clock, type, missing-Instant, and overflow failures are exposed as contained diagnostic
  variants. Implements Kalada #5 from Formbar #93.

## 0.2.0

### Minor Changes

- 3289aa3: Add the collision-safe `kalada-v1` Option, Result, and exhaustive-match subpath for Kalada #4 and Formbar #93. Matching is intentionally limited to these two ADTs and has no guards.

## 0.1.0

### Minor Changes

- b3f629c: Establish the dependency-free `@kalada/core` package shell and architecture boundary from
  Kalada #1 and Formbar #93.
- a4f3d0b: Add the exact Kuery 2.1 strict-expression extraction at `@kalada/core/kuery-v1` and the
  versioned Kalada program envelope at `@kalada/core`.

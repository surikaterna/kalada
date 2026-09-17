# ADR-0002: Explicit deterministic time semantics

- Status: Accepted
- Date: 2026-09-17
- Decision sources: [Kalada #5](https://github.com/surikaterna/kalada/issues/5) and
  [Formbar #93](https://github.com/surikaterna/formbar/issues/93)

## Context

Kalada needs replayable time values without making evaluation depend on an ambient clock. The
first temporal slice must be portable across JavaScript runtimes, bounded by the existing value
and evaluation limits, and compatible with the collision-safe Option and Result value model.

## Decision

### Values and precision

`Instant` and `Duration` are distinct nominal runtime values. Both store an integer number of
milliseconds in the inclusive range `Number.MIN_SAFE_INTEGER` through
`Number.MAX_SAFE_INTEGER`. Negative values are valid and `-0` is canonicalized to `0`. Values
are frozen and recognized by private `WeakSet` brands; structurally similar objects, copies,
proxies, and JSON round trips are not temporal values.

The factories are `Instant.fromMilliseconds(number)` and `Duration.fromMilliseconds(number)`.
They throw `RangeError` for non-integers, non-finite numbers, or values outside the safe-integer
range. No parsing, formatting, calendar, locale, or timezone interpretation is implied.

### Canonical expressions and operations

The `kalada-v1` AST adds `instant`, `duration`, `current-instant`, `temporal-arithmetic`, and
`temporal-comparison` nodes. Literal milliseconds use the same inclusive safe-integer bounds.
Canonicalization freezes nodes, rejects extra fields and hostile inputs, normalizes `-0`, and
charges every temporal expression as one AST node.

Arithmetic is typed as follows:

| Operation | Result |
| --- | --- |
| `Instant + Duration` | `Instant` |
| `Duration + Duration` | `Duration` |
| `Instant - Instant` | `Duration` |
| `Instant - Duration` | `Instant` |
| `Duration - Duration` | `Duration` |

All other operand combinations fail with `KALADA_TEMPORAL_TYPE_MISMATCH`. Arithmetic whose
result is not a safe integer fails with `KALADA_TEMPORAL_OVERFLOW`; values never wrap or lose
precision. `equal`, `not-equal`, `less-than`, `less-than-or-equal`, `greater-than`, and
`greater-than-or-equal` compare milliseconds only when both operands have the same temporal
type. Evaluation is left-first, stops on the first failure, and charges exactly one evaluation
step per evaluated AST node.

### Explicit current time

`compiled.evaluate(resolve, { instant })` accepts a pre-sampled branded `Instant`.
`current-instant` returns that same immutable object and fails with `KALADA_INSTANT_REQUIRED`
when it is absent. Evaluation never reads `Date`, `performance`, timers, environment state, or
another ambient time source.

`compiled.evaluateWithClock(resolve, clock)` is the sole clock convenience boundary. It calls
the supplied synchronous clock eagerly and exactly once for each top-level evaluation, validates
the branded `Instant`, and passes that sample inward. Throwing, Promise-returning, invalid, and
hostile clocks become stable diagnostics. Nested or repeated `current-instant` reads cannot
resample.

### Serialization and composition

The version-1 value codec uses exact envelopes with type `Instant` or `Duration`, variant
`milliseconds`, and a safe-integer `value`. Decoding recreates nominal frozen values and
normalizes `-0`. Temporal values may be nested in Option and Result without implicit JSON
decoding. Each temporal value is one value node for depth and node budgets. Program and value
JSON Schemas describe the same exact shapes and bounds.

## Consequences

Temporal evaluation remains deterministic for a canonical program, resolver outcomes, limits,
and explicit sample. Hosts retain ownership of clock acquisition and can persist the sample for
replay. The safe-integer millisecond model is deliberately smaller than a date/time library but
has stable cross-runtime arithmetic and serialization.

## Non-goals

This decision adds no calendars, civil dates, time zones, locale behavior, parsing, formatting,
scheduling, timers, delays, recurrence, functions, syntax, or projection behavior. It does not
add ambient clock access or any runtime dependency.

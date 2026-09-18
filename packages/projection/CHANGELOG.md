# @kalada/projection

## 0.1.0

### Minor Changes

- bdeec2b: Add the canonical projection v1 contracts and compiler boundary without runtime evaluation.
- 6ea9024: Add deterministic compiled evaluation for projection `value`, `object`, `array`, and strict-boolean
  `if` nodes, including contextual `Option.none` omission and transactional output limits.
- 10484ba: Add bounded deterministic `map` evaluation with lexical item and index bindings, cumulative
  iteration limits, omission compaction, and transactional output accounting.
- a04f26f: Make projection output byte accounting browser-safe without changing deterministic UTF-8 limits.
- Correct the unpublished first release to consume the canonical `@kalada/core@^0.5.0` root.

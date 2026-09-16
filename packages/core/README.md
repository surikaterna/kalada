# `@kalada/core`

This package is the dependency-free home of Kalada's canonical, versioned runtime contracts.
It is currently an architecture-facing shell: only package identity is exported, and no AST,
compiler, evaluator, operator, profile, parser, effects, or scheduling semantics exist yet.

The public contract will be added through separately reviewed changes after its serialization,
compatibility, determinism, and resource boundaries are specified.

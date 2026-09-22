# Editor and Scheman demo: architecture handoff for #78 and #79

- Status: **Proposed implementation plan**, not an accepted ADR or implementation claim.
- Date: 2026-09-22.
- Exact researched baseline: `origin/main` `82ccbf6c90a131b95826ccf6594a438d190b48fe`.
- Parents: [#78](https://github.com/surikaterna/kalada/issues/78),
  [#79](https://github.com/surikaterna/kalada/issues/79).
- Authority: [accepted ADR-0006](../adr/0006-prepared-execution-schema-tooling.md).
- Entry points: [#78 implementation plan](./0078-completion-hover-codemirror.md),
  [#79 implementation plan](./0079-scheman-demo-workspace.md).

## Objective

Freeze implementable decisions before changing implementation models. The two plans distinguish
baseline signatures from **PROPOSED** additive contracts. They authorize no feature code in this
architecture branch. The issue bodies were read in full; their old `225c60e` dependency baseline is
superseded for planning by the SHA above. #73, #76, and #77 are merged there. #75 remains deliberately
planned/deferred. #81/PR #82 are open: unmerged ADR-0007 is not accepted main authority.

## Decisions and material acceptance amendments

1. #78 is vendor-neutral and manual-fixture-first. Publish the thin editor as
   **`@kalada/codemirror`**, separately from `@kalada/language-service`.
2. Keep the real synchronous URI-based service calls, captured snapshot identity, typed cancellation,
   and final `isCurrent` check. Do not introduce an LSP request envelope or Promise-based core API.
3. Syntax has dot/optional-dot access, but **no bracket indexes, quoted field access, locals, lambdas,
   or supported comments**. Arrays/tuples/quoted keys are inspectable shape, not a license to add syntax.
   Refs, union branches, and nested object fields remain completion requirements. Recommend amending
   the array/tuple acceptance to require bounded structural inspection and explicit inaccessible-path
   evidence; defer source index completion until syntax owns it. Alternative: a separately approved
   language-syntax issue, not hidden work in #78. This is a real product acceptance decision for Builder.
4. Syntax currently exports whole-expression `resultType`, not a subtree semantic/operator query.
   #78-S is an accountable additive public syntax unit using existing lowering/dispatch internals;
   never copy those tables into the service. It requires a minor syntax Changeset. Omitting it means
   reducing semantic/operator hover/completion acceptance, which is not the recommendation.
5. **Replace #79's #75 dependency with merged #76**, preserving actual validation. Scheman v2 JSON
   ingestion builds structure; it does not manufacture a validator. Use a separately pinned,
   non-code-generating JSON validator (`@cfworker/json-schema` 4.1.1) behind an app-only Standard Schema
   bridge. #75 is not needed merely to implement that bridge. No Zod/Standard adapter package is added.
6. #79 uses Vite + TypeScript + DOM + CodeMirror, no UI framework, in private `apps/demo`. A single
   whole-data binding named `data` avoids unsound per-property validation and environment merging.
7. JSON Schema support is a strict, bounded, documented 2020-12 subset. Only local JSON Pointer refs;
   recursive edges must consume an instance child, and admission rejects excessive expansion.
   Unknown keywords are errors, not ignored annotations. Arbitrary JSON Schema is not promised.
8. Generate candidates from the **input** graph using an app-local deterministic bounded generator;
   every published candidate must pass the real whole-data validator. No validator/type system is
   implemented inside the generator. Unsupported/unsatisfiable shapes visibly require manual data.
9. Inspectors copy allowlisted data into immutable DTOs. User source/literals and intentional data/result
   panes are separately labeled sensitive content, never silently mixed into diagnostics or exports.
10. Bundled browser support only. Retain current ESM/CJS/types conventions pending #81. #87 owns later
    sizing/compute baselines; no invented bundle budget, worker prerequisite, or performance SLO here.

## Dependencies and executable order

```text
merged #72 -> merged #73
merged #72 -> merged #76
merged #73 + merged #72 -> merged #77
merged #77 -> #78-S -> #78-L -> #78-C -> #78-P -> audit/merge #78
merged #73 + merged #76 + merged #78 -> #79-V -> #79-W -> #79-L
                                                    |          |
                                                    +-> #79-G  +-> #79-I
                                                         \       /
                                                         #79-B -> audit/merge #79 -> #80
#81: parallel package-policy decision; not a bundled-browser blocker
#87: later measured size/compute review; final composition follows #78/#79/#81
```

Unit IDs such as `#78-S` are **plan-local units under the existing parent issue**, not invented GitHub
issue numbers. Builder may create child issues linked to those parents before assignment. #79 cannot
start feature implementation until #78 merges. Validator dependency/browser verification is the first
#79 unit, not a new mandatory performance gate. Genuine failure there blocks execution/generation:
never replace it with “Scheman says valid.”

## Exact suggested issue amendments (not applied)

All amendments below remain **proposed and unapplied pending next-model approval**. The docs audit PASS
is not approval to edit GitHub or acceptance of a new ADR.

For **#78**, replace “Dependencies and status” with:

> Ready: #77 and its #72/#73 prerequisites are merged at
> `82ccbf6c90a131b95826ccf6594a438d190b48fe`. Generic completion/hover uses manual fixtures and depends on
> neither #75 nor #76. Blocks #79. Scheman-first demo integration belongs to #79 after merged #76 and
> #78; #75 remains deferred. #21 blocks only future imports/modules/cross-file semantics. External
> Scheman #34/#35 are not generic-tooling blockers. Implementation plan:
> `docs/architecture/0078-completion-hover-codemirror.md`.

Add to **#78** acceptance/design:

> Current source completion supports only syntax-owned forms. Array/tuple/index and non-identifier
> key shape is inspected with explicit inaccessible-path evidence, not emitted as unsupported syntax.
> Subtree semantic/operator facts come from an additive public syntax query using the same dispatch
> as lowering. Include a minor Changeset for syntax as well as language-service and @kalada/codemirror.

For **#79**, replace the Standard wording in Objective and the third Scope bullet with:

> Compose synchronous host execution, Scheman v2 JSON input/output structure through
> @kalada/adapter-scheman, actual whole-data JSON validation via an app-local Standard Schema bridge
> over @cfworker/json-schema 4.1.1, the headless language service, and @kalada/codemirror. JSON Schema
> ingestion alone does not validate. Support the strict bounded 2020-12 subset in
> `docs/architecture/0079-scheman-demo-workspace.md`; reject unsupported vocabulary rather than claim
> validity. Generate from input shape and validate every candidate before application.

Replace **#79**'s dependency/status and Engineer prerequisite text with:

> Blocked by #78 merge. Required dependencies are #73 + #76 + #78; #73/#76 are already merged.
> Replace the former #75 hard dependency with #76 deliberately for the approved Scheman-first demo.
> #75 remains planned/deferred. #21 and external Scheman #34/#35 are not blockers for independent files
> and same-document pointer refs. #79 blocks #80. #87 is a planned follow-up and #81 is not a bundled
> demo blocker. Engineer starts from then-current main after #78 merges.

Add to **#79** acceptance:

> All files use one binding `data` for the complete JSON value. Recursive refs must consume an instance
> child; unsupported or over-budget schema admission is a visible error. Advanced artifact inspectors
> serialize only bounded allowlisted DTOs; source/literal content requires explicit reveal and is not
> persisted/exported as diagnostic metadata. Current field semantics remain dynamic where syntax says
> dynamic, even when input shape is detailed. No claim of arbitrary JSON Schema support is made.

For **#75**, add this reciprocal dependency/status amendment:

> #75 remains planned/deferred and no longer blocks the proposed Scheman-first #79. That demo uses
> merged #76 plus an app-local validator bridge, alongside #73 and #78; it does not implement or close
> #75. The standalone Standard adapter scope remains deferred. This dependency amendment is proposed,
> not applied, pending next-model approval of the #78/#79 architecture handoff.

After next-model approval, Builder/Diplomat should align #78's blocked label with Ready and keep #79
blocked. Do not mark either feature implemented because architecture exists. Also record the
Scheman-first dependency amendment against ADR-0006's historical follow-up items 7/8 when this plan is
approved; do not rewrite its accepted semantic separation or pretend its historical Standard sequencing
already said Scheman-first.

## Acceptance, risks, and handoff

This docs deliverable is accepted when both linked plans contain signatures, file targets, ordered
units, tests, lifecycle/security constraints, Changesets, prohibited scope, and honest compatibility
limits. Only Markdown is changed, with local links/whitespace/spelling review. There is no docs lint
or spellchecker configured; Biome does not check Markdown here. No runtime suite or Changeset is
required for these writings. No issue body/label is changed and no PR, merge, or publication is made.

**Next owner: Builder**, #78/#79. Approve the material scope clarifications above and copy the exact
amendments before assigning Engineer. The fresh-model entry point is this file, then the relevant
self-contained issue plan. Engineer must use the specified implementation worktree, follow the
Universal PR Checklist (cohesive <=400-line production files, <50-line functions, <=3 nesting levels),
and attach unit-specific evidence before setting `implemented`. Auditor sets `verified` or
`changes_requested`; Diplomat alone handles `in_review` and merge/closure. Use repository label spelling
when translating these protocol states. Discovered work must become a linked parent follow-up, not
silent scope expansion. No implementation assertion is made by these documents.

### Architecture-writing validation record

At the researched worktree on 2026-09-22: all three Markdown documents passed a local relative-link,
balanced-code-fence, final-newline, tabs, and trailing-whitespace check (31 relative links resolved).
Public call shapes were checked against the linked baseline source; Scheman v2 and validator 4.1.1
published declarations/entry code were inspected read-only. Spelling and terminology were reviewed
manually; no spellchecker or Markdown lint is installed/configured. `git diff --check` and a Markdown-only
changed-path check are required again before commit/push. Runtime tests, install, build, and Changesets
were intentionally not run/added for this docs-only deliverable. GitHub issue bodies/statuses are unchanged.

### Docs audit follow-up

Docs audit **PASS**, as reported in the handoff, with three clarifications incorporated: input-root-only
canonicalization independent of synthetic aliases/definition-table order; one complete exact-key
workspace envelope; and the proposed reciprocal #75 dependency amendment. The PASS context is retained
without claiming feature verification or accepted-ADR status. These are documentation-only refinements;
all GitHub amendments remain proposed/unapplied until next-model approval. Follow-up validation passed:
31 relative links, balanced fences, whitespace/newlines, `git diff --check`, and exactly the two intended
Markdown files changed. No Changeset, runtime suite, feature code, or GitHub changes.

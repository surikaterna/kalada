# Unpublished-package correction policy

This policy is deny-by-default. A merged version is immutable once that exact package/version has
ever existed on npm. The `unpublished-package-correction` exception exists only to correct an
already-versioned workspace package whose exact version has never been published. It is not a
general no-Changeset mechanism and it does not authorize publication.

## Approval and evidence

Before opening the correction PR, the owner must authorize the exact package, version, reason, and
PR base SHA in a repository issue. The exception record must repeat those values and link that
owner-authorization issue, an Auditor review issue, and the issue responsible for removing the
temporary control. The Auditor must record approval in the linked review issue before merge; a URL
alone is not approval. Approval of the exception only permits review and merge of the declared
correction. Release approval remains a separate owner decision and release workflow.

Immediately before use, run the canonical command recorded by the schema:

```sh
npm view <package>@<version> version --json --registry=https://registry.npmjs.org
```

The explicit `--registry` makes ambient npm configuration irrelevant and must not be omitted or
replaced. Capture the complete JSON E404 response and its SHA-256 digest. Evidence must be newer
than the PR base, must not be captured after the validation time, must expire no more than 24 hours
after capture, and must remain unexpired when CI validates it. Mutable registry output is an
observation, not permanent proof. The owner and Auditor must re-check npm before merge and again
before any later release or manual bootstrap.

## Machine-enforced boundary

`release-exceptions/schema.v2.json` defines one package and one version. The executable fixture in
`tests/changeset-policy-v2.test.ts` is the reviewable template; production records belong in
`release-exceptions/` only in the separately authorized correction PR. Its projection `0.1.0`
fixture uses generated hashes, timestamps, and test-only issue links; it is not a concrete record
for #46 and cannot authorize a correction or publication.

Every changed file inside the named workspace package must be listed literally with `add`, `mod`,
or `del` status and the applicable base/head SHA-256 values (`null` for the absent side). Wildcards,
path traversal, undeclared files, renames, symlinks, executable modes, binary files, hash drift,
package name changes, and version changes are rejected. Files outside that package are not covered
by the exception. Ordinary test or verification changes may accompany it under normal policy.

Other publishable packages retain normal Changesets enforcement. Thus a mixed PR may carry a
normal Changeset for core while the exception covers only projection. An exception is rejected if
it covers no otherwise-uncovered publishable package, if more than one package is uncovered, or if
its registry response does not prove E404 for the exact package/version. Existing exception records
are immutable; follow-up facts must be recorded in issues rather than rewriting merged evidence.
Schema v1 and the historical core bootstrap record remain supported and unchanged.

Generated release PRs continue through the independent release-integrity validator. Exception
records are never consulted by that validator and cannot relax artifact, version, Changeset, or
release-selection checks.

## Stop, rollback, and removal

Stop without merging or publishing if any of these conditions occurs:

- npm returns anything other than E404 for the exact package/version;
- evidence expires or no longer matches its captured hash;
- the PR base, package, version, file manifest, or correction reason changes;
- correction scope leaves the named package or an ordinary verification change;
- packed artifact parity, release integrity, or Auditor review fails.

If the version appears on npm, version reuse is permanently forbidden; return to ordinary
Changesets and select a new version after a fresh audit. If a pre-merge check fails, close or revise
the PR from a fresh authorized base rather than weakening the validator. If a merged correction is
not releasable, do not mutate its immutable record or force-publish: stop the release and open a new
owner-authorized issue.

The removal issue must delete any temporary release selection control once the first publication
and trusted-publisher setup are complete. Manual first-publication evidence must identify the owner
and exact audited artifact and must not claim GitHub Actions OIDC or SLSA provenance. Every later
release uses the normal trusted workflow.

import { assertNoChangedEmptyChangesets, changedPackagesFromChangesets } from "./changesets.js";
import { addedException, validateException } from "./exception.js";
import { assertCommit, diffEntries } from "./git.js";
import { affectedPackages, publishablePackages } from "./manifests.js";

export function validateChangesetPolicy(
  repository: string,
  base: string,
  head: string,
  repositoryName: string,
): void {
  assertInputs(base, head, repositoryName);
  assertCommit(repository, base, "Base");
  assertCommit(repository, head, "Head");
  const entries = diffEntries(repository, base, head);
  assertNoChangedEmptyChangesets(repository, head, entries);
  const packages = mergedPackages(repository, base, head);
  const workspaceNames = new Set([...packages.values()].map(({ name }) => name));
  const declared = changedPackagesFromChangesets(repository, head, entries, workspaceNames);
  const affected = affectedPackages(entries, packages);
  const uncovered = new Set([...affected].filter((name) => !declared.has(name)));
  const exception = addedException(repository, head, entries);
  if (uncovered.size === 0 && exception) throw new Error("Release exception is unnecessary");
  if (uncovered.size > 0 && !exception)
    throw new Error(`Missing Changeset for ${[...uncovered].join(", ")}`);
  if (uncovered.size > 1) throw new Error("One exception may authorize exactly one package");
  if (exception)
    validateException(repository, base, head, repositoryName, entries, exception, uncovered);
}

function assertInputs(base: string, head: string, repository: string): void {
  if (!/^[0-9a-f]{40}$/u.test(base) || !/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error("Base and head must be immutable 40-character commit SHAs");
  }
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repository)) {
    throw new Error("Repository must be the immutable PR repository full name");
  }
}

function mergedPackages(repository: string, base: string, head: string) {
  return new Map([
    ...publishablePackages(repository, base),
    ...publishablePackages(repository, head),
  ]);
}

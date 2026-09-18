export type DiffEntry = {
  baseMode: string;
  headMode: string;
  path: string;
  status: "A" | "D" | "M";
};

export type PackageManifest = {
  name?: string;
  private?: boolean;
  version?: string;
  repository?: unknown;
  [key: string]: unknown;
};

export type V1ExceptionFile = {
  path: string;
  changeClass: "package-manifest-repository" | "package-verification";
  baseSha256: string;
  headSha256: string;
};

export type V1ReleaseException = {
  schemaVersion: 1;
  exceptionClass: "already-versioned-unpublished-correction";
  issue: string;
  repository: string;
  baseCommit: string;
  package: {
    name: string;
    path: string;
    version: string;
    baseManifestSha256: string;
    headManifestSha256: string;
    repository: { type: "git"; url: string; directory: string };
  };
  files: V1ExceptionFile[];
  observedRegistryEvidence: {
    registry: "https://registry.npmjs.org";
    package: string;
    version: string;
    status: "not-found";
    httpStatus: 404;
    capturedAt: string;
    command: string;
    response: string;
    responseSha256: string;
  };
};

export type V2ExceptionFile = {
  path: string;
  status: "add" | "mod" | "del";
  baseSha256: string | null;
  headSha256: string | null;
};

export type V2ReleaseException = {
  schemaVersion: 2;
  exceptionKind: "unpublished-package-correction";
  repository: string;
  reason: string;
  authorization: { issueUrl: string; baseCommit: string };
  reviewIssueUrl: string;
  removalIssueUrl: string;
  expiresAt: string;
  package: { name: string; path: string; version: string };
  files: V2ExceptionFile[];
  registryEvidence: {
    registry: "https://registry.npmjs.org";
    package: string;
    version: string;
    status: "not-found";
    httpStatus: 404;
    capturedAt: string;
    command: `npm view ${string} version --json --registry=https://registry.npmjs.org`;
    response: string;
    responseSha256: string;
  };
};

export type ReleaseException = V1ReleaseException | V2ReleaseException;

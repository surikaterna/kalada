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

export type ExceptionFile = {
  path: string;
  changeClass: "package-manifest-repository" | "package-verification";
  baseSha256: string;
  headSha256: string;
};

export type ReleaseException = {
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
  files: ExceptionFile[];
  observedRegistryEvidence: {
    registry: "https://registry.npmjs.org";
    package: string;
    version: string;
    status: "not-found";
    httpStatus: 404;
    observedAt: string;
    command: string;
    response: string;
    responseSha256: string;
  };
};

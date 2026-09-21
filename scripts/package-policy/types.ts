export interface PackedFile {
  readonly path: string;
}

export interface PackResult {
  readonly filename: string;
  readonly files: readonly PackedFile[];
}

export interface PackagePolicy {
  readonly workspace: string;
  readonly filesField: readonly string[];
  readonly packedFiles: readonly string[];
  readonly exports: Readonly<Record<string, unknown>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly runtimeImports: Readonly<Record<"dist/index.js" | "dist/index.cjs", readonly string[]>>;
}

export interface PackedPackage {
  readonly archive: string;
  readonly manifest: Record<string, unknown>;
  readonly policy: PackagePolicy;
  readonly result: PackResult;
}

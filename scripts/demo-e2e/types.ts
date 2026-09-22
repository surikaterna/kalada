import type { Page } from "playwright";

export interface BundleEntry {
  readonly file: string;
  readonly type: string;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  readonly facadeModuleId: string | null;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly implicitlyLoadedBefore: readonly string[];
  readonly referencedFiles: readonly string[];
  readonly importedAssets: readonly string[];
  readonly importedCss: readonly string[];
  readonly modules: readonly string[];
}

export interface BundleEvidence {
  readonly format: "kalada-demo-bundle-v2";
  readonly base: string;
  readonly entries: readonly BundleEntry[];
}

export interface ArtifactSummary {
  readonly files: readonly string[];
  readonly runtimeFiles: ReadonlySet<string>;
  readonly lazyEnvironmentFiles: ReadonlySet<string>;
  readonly entryStaticFiles: ReadonlySet<string>;
}

export interface RequestRecord {
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  status: number | "failed" | null;
}

export interface ScenarioContext {
  readonly page: Page;
  readonly baseUrl: string;
  readonly requests: RequestRecord[];
}

export interface Scenario {
  readonly name: string;
  readonly run: (context: ScenarioContext) => Promise<void>;
}

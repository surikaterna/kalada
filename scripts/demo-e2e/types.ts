import type { Page } from "playwright";
import type { InventoryCount } from "./capability-inventory.js";

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

export interface BundleClosures {
  readonly staticFiles: ReadonlySet<string>;
  readonly dynamicFiles: ReadonlySet<string>;
}

export interface ArtifactSummary {
  readonly files: readonly string[];
  readonly runtimeFiles: ReadonlySet<string>;
  readonly lazyEnvironmentFiles: ReadonlySet<string>;
  readonly entryStaticFiles: ReadonlySet<string>;
  readonly inventory: ArtifactInventory;
}

export interface ArtifactInventoryFile {
  readonly file: string;
  readonly sha256: string;
  readonly closure: "entry-static" | "lazy-environment" | "shell";
  readonly imports: readonly InventoryCount[];
  readonly capabilities: readonly InventoryCount[];
  readonly urlLiterals: readonly InventoryCount[];
  readonly contributors: readonly string[];
}

export interface ArtifactInventory {
  readonly format: "kalada-demo-artifact-v1";
  readonly scope: "bounded-observed-syntax-not-general-javascript-proof";
  readonly base: "/kalada/";
  readonly files: readonly ArtifactInventoryFile[];
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

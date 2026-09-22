import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { inventoryJavaScript } from "./capability-inventory.js";
import { DEMO_BASE, DIST, ROOT } from "./config.js";
import type {
  ArtifactInventory,
  ArtifactInventoryFile,
  BundleEntry,
  BundleEvidence,
} from "./types.js";

export const EXPECTED_INVENTORY = resolve(
  ROOT,
  "scripts/demo-e2e/expected-artifact-inventory.json",
);

export function createArtifactInventory(
  evidence: BundleEvidence,
  runtimeFiles: ReadonlySet<string>,
  staticFiles: ReadonlySet<string>,
  dynamicFiles: ReadonlySet<string>,
): ArtifactInventory {
  const byFile = new Map(evidence.entries.map((entry) => [entry.file, entry]));
  const files = [...runtimeFiles]
    .sort()
    .map((file) => inventoryFile(file, byFile.get(file), staticFiles, dynamicFiles));
  return {
    format: "kalada-demo-artifact-v1",
    scope: "bounded-observed-syntax-not-general-javascript-proof",
    base: DEMO_BASE,
    files,
  };
}

export function assertExpectedInventory(actual: ArtifactInventory): void {
  const expected = readFileSync(EXPECTED_INVENTORY, "utf8");
  const normalized = serializeInventory(actual);
  if (normalized !== expected) {
    throw new Error(
      "Demo artifact inventory drifted; review the emitted bytes, capabilities, imports, and contributors before updating expected-artifact-inventory.json",
    );
  }
}

export function serializeInventory(inventory: ArtifactInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function inventoryFile(
  file: string,
  entry: BundleEntry | undefined,
  staticFiles: ReadonlySet<string>,
  dynamicFiles: ReadonlySet<string>,
): ArtifactInventoryFile {
  const source = readFileSync(resolve(DIST, file));
  const javascript = file.endsWith(".js")
    ? inventoryJavaScript(file, source.toString("utf8"))
    : { imports: [], capabilities: [], urlLiterals: [] };
  if (file.endsWith(".js")) assertImportsMatch(file, javascript.imports, entry);
  return {
    file,
    sha256: createHash("sha256").update(source).digest("hex"),
    closure: closureName(file, staticFiles, dynamicFiles),
    imports: javascript.imports,
    capabilities: javascript.capabilities,
    urlLiterals: javascript.urlLiterals,
    contributors: (entry?.modules ?? []).map(normalizeContributor).sort(),
  };
}

function assertImportsMatch(
  file: string,
  imports: ArtifactInventoryFile["imports"],
  entry: BundleEntry | undefined,
): void {
  if (entry?.type !== "chunk") throw new Error(`JavaScript chunk metadata is missing: ${file}`);
  const observedStatic = resolvedImports(file, imports, "static:");
  const observedDynamic = resolvedImports(file, imports, "dynamic:");
  if (!sameList(observedStatic, entry.imports)) {
    throw new Error(`Static import inventory differs from metadata for ${file}`);
  }
  if (!sameList(observedDynamic, entry.dynamicImports)) {
    throw new Error(`Dynamic import inventory differs from metadata for ${file}`);
  }
}

function resolvedImports(
  file: string,
  imports: ArtifactInventoryFile["imports"],
  prefix: "dynamic:" | "static:",
): string[] {
  return imports
    .filter(({ name }) => name.startsWith(prefix))
    .flatMap(({ name, count }) => {
      const specifier = name.slice(prefix.length);
      const resolved = posix.normalize(posix.join(dirname(file).split(sep).join("/"), specifier));
      return Array.from({ length: count }, () => resolved);
    })
    .sort();
}

function normalizeContributor(module: string): string {
  if (module.startsWith("\0")) return `virtual:${module.slice(1)}`;
  const normalized = module.split(sep).join("/");
  const root = ROOT.split(sep).join("/");
  if (!normalized.startsWith(`${root}/`))
    throw new Error(`Contributor is outside the repository: ${module}`);
  const local = relative(ROOT, module).split(sep).join("/");
  if (!/^(?:apps\/demo|node_modules\/\.bun|packages\/)/u.test(local)) {
    throw new Error(`Unexpected bundle contributor: ${local}`);
  }
  return local;
}

function closureName(
  file: string,
  staticFiles: ReadonlySet<string>,
  dynamicFiles: ReadonlySet<string>,
): ArtifactInventoryFile["closure"] {
  if (file === "index.html") return "shell";
  if (staticFiles.has(file)) return "entry-static";
  if (dynamicFiles.has(file)) return "lazy-environment";
  throw new Error(`Runtime file is outside the reviewed closures: ${file}`);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

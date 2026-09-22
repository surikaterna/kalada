import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { ROOT } from "./config.js";
import type { BundleEntry, BundleEvidence } from "./types.js";

const FORBIDDEN_IDENTIFIERS = new Set([
  "Buffer",
  "EventSource",
  "WebSocket",
  "XMLHttpRequest",
  "__dirname",
  "__filename",
  "fetch",
  "process",
  "require",
]);
const FORBIDDEN_PROPERTIES = new Set([
  "Buffer",
  "EventSource",
  "WebSocket",
  "XMLHttpRequest",
  "fetch",
  "process",
  "sendBeacon",
]);
const VENDOR =
  /(?:node_modules\/(?:@cfworker\/json-schema|@scheman\/core)|packages\/adapter-scheman)\//u;

export function assertExactPins(): void {
  const root = packageJson(resolve(ROOT, "package.json"));
  const demo = packageJson(resolve(ROOT, "apps/demo/package.json"));
  const lock = readFileSync(resolve(ROOT, "bun.lock"), "utf8");
  if (root.devDependencies?.playwright !== "1.63.0") throw new Error("Playwright pin drifted");
  if (demo.dependencies?.["@cfworker/json-schema"] !== "4.1.1") {
    throw new Error("cfworker pin drifted");
  }
  if (demo.dependencies?.["@scheman/core"] !== "2.0.0") throw new Error("Scheman pin drifted");
  for (const pin of [
    '"playwright@1.63.0"',
    '"@cfworker/json-schema@4.1.1"',
    '"@scheman/core@2.0.0"',
  ]) {
    if (!lock.includes(pin)) throw new Error(`Lockfile pin is missing: ${pin}`);
  }
}

export function assertBundleBoundaries(evidence: BundleEvidence): Set<string> {
  const byFile = new Map(evidence.entries.map((entry) => [entry.file, entry]));
  const entry = evidence.entries.find((item) => item.type === "chunk" && item.isEntry);
  if (!entry) throw new Error("Bundle entry chunk is missing");
  const staticFiles = closure(byFile, [entry.file], false);
  const dynamicRoots = [...staticFiles].flatMap((file) => byFile.get(file)?.dynamicImports ?? []);
  const dynamicFiles = closure(byFile, dynamicRoots, true);
  const environment = evidence.entries.find((item) =>
    item.modules.some((module) => module.endsWith("/apps/demo/src/schema/environment.ts")),
  );
  if (!environment || !dynamicFiles.has(environment.file)) {
    throw new Error("Lazy environment chunk is missing from the dynamic closure");
  }
  assertVendorPlacement(evidence.entries, staticFiles, dynamicFiles, environment.file);
  return staticFiles;
}

function assertVendorPlacement(
  entries: readonly BundleEntry[],
  staticFiles: Set<string>,
  dynamicFiles: Set<string>,
  environmentFile: string,
): void {
  const vendorEntries = entries.filter((entry) =>
    entry.modules.some((module) => VENDOR.test(module)),
  );
  if (!vendorEntries.some(hasCfworker) || !vendorEntries.some(hasScheman)) {
    throw new Error("Expected cfworker and Scheman modules are missing");
  }
  for (const entry of vendorEntries) {
    if (staticFiles.has(entry.file) || !dynamicFiles.has(entry.file)) {
      throw new Error(`Schema vendor escaped the lazy closure: ${entry.file}`);
    }
    if (entry.file !== environmentFile) {
      throw new Error(`Schema vendor leaked outside its isolated environment chunk: ${entry.file}`);
    }
  }
  assertExpectedScheman(entries);
}

function assertExpectedScheman(entries: readonly BundleEntry[]): void {
  for (const module of entries.flatMap((entry) => entry.modules)) {
    if (
      /node_modules\/@scheman\//u.test(module) &&
      !/node_modules\/@scheman\/core\//u.test(module)
    ) {
      throw new Error(`Unexpected Scheman package: ${module}`);
    }
    if (/(?:^|\/)zod(?:\/|$)/iu.test(module)) throw new Error(`Unexpected Zod module: ${module}`);
    if (
      /node_modules\/(?:node-fetch|undici|ws)(?:\/|$)/u.test(module) ||
      /(?:^|[\\/])node:/u.test(module) ||
      /^(?:fs|http|https|net|tls)$/u.test(module)
    ) {
      throw new Error(`Forbidden browser runtime dependency: ${module}`);
    }
  }
}

export function assertJavaScriptSecurity(path: string, source: string): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const failures = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      FORBIDDEN_IDENTIFIERS.has(node.text) &&
      isIdentifierReference(node)
    ) {
      failures.add(node.text);
    }
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) {
      failures.add(node.name.text);
    }
    if (isDynamicCode(node)) failures.add(node.expression.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (failures.size)
    throw new Error(`Forbidden runtime primitive in ${path}: ${[...failures].join(", ")}`);
}

function isDynamicCode(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
  return ts.isIdentifier(node.expression) && ["eval", "Function"].includes(node.expression.text);
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isTypeOfExpression(parent) && parent.expression === node) return false;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node)
  ) {
    return false;
  }
  return true;
}

function closure(
  entries: ReadonlyMap<string, BundleEntry>,
  roots: readonly string[],
  includeDynamic: boolean,
): Set<string> {
  const found = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const file = pending.pop();
    if (!file || found.has(file)) continue;
    const entry = entries.get(file);
    if (!entry) throw new Error(`Bundle import does not resolve: ${file}`);
    found.add(file);
    pending.push(
      ...entry.imports,
      ...entry.importedCss,
      ...entry.importedAssets,
      ...entry.referencedFiles,
    );
    if (includeDynamic) pending.push(...entry.dynamicImports);
  }
  return found;
}

function hasCfworker(entry: BundleEntry): boolean {
  return entry.modules.some((module) => module.includes("node_modules/@cfworker/json-schema/"));
}

function hasScheman(entry: BundleEntry): boolean {
  return entry.modules.some(
    (module) =>
      module.includes("node_modules/@scheman/core/") ||
      module.includes("packages/adapter-scheman/"),
  );
}

function packageJson(path: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(path, "utf8"));
}

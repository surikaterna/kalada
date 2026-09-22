import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { APP, DEMO_BASE, DIST } from "./config.js";
import { assertBundleBoundaries, assertExactPins, assertJavaScriptSecurity } from "./security.js";
import type { ArtifactSummary, BundleEntry, BundleEvidence } from "./types.js";

const EVIDENCE = "demo-metafile.json";
const RUNTIME_FILE = /^(?:index\.html|assets\/[A-Za-z0-9_.-]+\.(?:css|js|png|svg|woff2?))$/u;

export function buildAndVerifyArtifact(): ArtifactSummary {
  rmSync(DIST, { force: true, recursive: true });
  const result = spawnSync("bun", ["run", "build"], {
    cwd: APP,
    env: { ...process.env, DEMO_BASE },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Demo build failed");
  const summary = inspectArtifact();
  cleanEvidenceFiles();
  assertFinalDist(summary.runtimeFiles);
  return { ...summary, files: [...summary.runtimeFiles].sort() };
}

export function inspectArtifact(): ArtifactSummary {
  assertExactPins();
  const evidence = readEvidence();
  if (evidence.base !== DEMO_BASE) throw new Error(`Unexpected bundle base: ${evidence.base}`);
  const entryStaticFiles = assertBundleBoundaries(evidence);
  const runtimeFiles = runtimeClosure(evidence.entries);
  assertEmittedUrls(runtimeFiles);
  for (const file of runtimeFiles) {
    if (file.endsWith(".js")) {
      const source = readFileSync(resolve(DIST, file), "utf8");
      assertNoRootAssetUrl(file, source);
      assertJavaScriptSecurity(file, source);
    }
  }
  const lazyEnvironmentFiles = new Set(
    evidence.entries
      .filter((entry) =>
        entry.modules.some((module) => module.endsWith("/apps/demo/src/schema/environment.ts")),
      )
      .map((entry) => entry.file),
  );
  return { files: [...runtimeFiles].sort(), runtimeFiles, lazyEnvironmentFiles, entryStaticFiles };
}

function readEvidence(): BundleEvidence {
  const parsed = JSON.parse(readFileSync(resolve(DIST, EVIDENCE), "utf8")) as BundleEvidence;
  if (parsed.format !== "kalada-demo-bundle-v2" || !Array.isArray(parsed.entries)) {
    throw new Error("Bundle evidence format is invalid");
  }
  return parsed;
}

function runtimeClosure(entries: readonly BundleEntry[]): Set<string> {
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));
  assertAllImportsResolve(entries, byFile);
  const roots = entries.filter((entry) => entry.isEntry).map((entry) => entry.file);
  const found = new Set<string>(["index.html"]);
  const pending = [...roots];
  while (pending.length) {
    const file = pending.pop();
    if (!file || found.has(file)) continue;
    const entry = byFile.get(file);
    if (!entry) throw new Error(`Artifact closure does not resolve ${file}`);
    found.add(file);
    pending.push(
      ...entry.imports,
      ...entry.dynamicImports,
      ...entry.importedAssets,
      ...entry.importedCss,
      ...entry.referencedFiles,
    );
  }
  for (const file of found) {
    if (!statSync(resolve(DIST, file)).isFile())
      throw new Error(`Artifact file is missing: ${file}`);
  }
  return found;
}

function assertAllImportsResolve(
  entries: readonly BundleEntry[],
  byFile: ReadonlyMap<string, BundleEntry>,
): void {
  for (const entry of entries) {
    const dependencies = [
      ...entry.imports,
      ...entry.dynamicImports,
      ...entry.importedAssets,
      ...entry.importedCss,
      ...entry.referencedFiles,
    ];
    for (const dependency of dependencies) {
      if (!byFile.has(dependency)) {
        throw new Error(`Bundle import does not resolve: ${entry.file} -> ${dependency}`);
      }
    }
  }
}

function assertEmittedUrls(runtimeFiles: ReadonlySet<string>): void {
  const html = readFileSync(resolve(DIST, "index.html"), "utf8");
  if (/\b(?:src|href)=["']\/assets\//u.test(html)) throw new Error("Root-only HTML asset URL");
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gu)) {
    const url = match[1];
    if (!url || url.startsWith("data:")) continue;
    if (!url.startsWith(DEMO_BASE)) throw new Error(`HTML URL does not honor ${DEMO_BASE}: ${url}`);
    const file = url.slice(DEMO_BASE.length);
    if (!runtimeFiles.has(file))
      throw new Error(`HTML URL is outside the artifact closure: ${url}`);
  }
  for (const file of runtimeFiles) {
    if (!file.endsWith(".css")) continue;
    const css = readFileSync(resolve(DIST, file), "utf8");
    assertNoRootAssetUrl(file, css);
  }
}

function assertNoRootAssetUrl(file: string, source: string): void {
  if (/(?:["'`(]|url\(\s*["']?)\/assets\//u.test(source)) {
    throw new Error(`Root-only asset URL in ${file}`);
  }
}

function cleanEvidenceFiles(): void {
  rmSync(resolve(DIST, EVIDENCE), { force: true });
  for (const file of listFiles(DIST)) {
    if (file.endsWith(".map")) rmSync(resolve(DIST, file));
  }
}

function assertFinalDist(expected: ReadonlySet<string>): void {
  const files = listFiles(DIST);
  if (files.some((file) => !RUNTIME_FILE.test(file))) {
    throw new Error(`Final dist contains a non-runtime file: ${files.join(", ")}`);
  }
  if (JSON.stringify(files.sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error("Final dist differs from the verified runtime closure");
  }
  for (const file of files) {
    const status = lstatSync(resolve(DIST, file));
    if (!status.isFile() || status.isSymbolicLink())
      throw new Error(`Unsafe artifact entry: ${file}`);
  }
}

export function listFiles(directory: string): string[] {
  const output: string[] = [];
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      const status = lstatSync(path);
      if (status.isSymbolicLink()) throw new Error(`Artifact symlink is forbidden: ${path}`);
      if (status.isDirectory()) visit(path);
      else output.push(relative(directory, path).split(sep).join("/"));
    }
  };
  visit(directory);
  return output;
}

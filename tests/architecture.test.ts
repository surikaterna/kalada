import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const codeMirror = resolve(root, "packages/codemirror");
const core = resolve(root, "packages/core");
const host = resolve(root, "packages/host");
const languageService = resolve(root, "packages/language-service");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("package boundaries", () => {
  it("creates only the intended packages", async () => {
    const entries = await readdir(resolve(root, "packages"), { withFileTypes: true });
    expect(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      "adapter-scheman",
      "codemirror",
      "core",
      "host",
      "language-service",
      "projection",
      "syntax",
    ]);
  });

  it("keeps core free of runtime dependencies", async () => {
    const manifest = await readJson(resolve(core, "package.json"));
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      expect(manifest[field], field).toBeUndefined();
    }
  });

  it("keeps host limited to Kalada dependencies and free of schema vendors", async () => {
    const manifest = await readJson(resolve(host, "package.json"));
    expect(manifest.dependencies).toEqual({
      "@kalada/core": "^0.5.0",
      "@kalada/syntax": "^0.0.0",
    });
    for (const field of ["optionalDependencies", "peerDependencies"]) {
      expect(manifest[field], field).toBeUndefined();
    }
    expect(JSON.stringify(manifest)).not.toMatch(/@scheman\/core|zod/iu);
  });

  it("keeps language service on public Kalada dependencies", async () => {
    const manifest = await readJson(resolve(languageService, "package.json"));
    expect(manifest.dependencies).toEqual({
      "@kalada/core": "^0.5.0",
      "@kalada/host": "^0.0.0",
      "@kalada/syntax": "^0.0.0",
    });
    const hostSource = await readFile(resolve(host, "src/index.ts"), "utf8");
    expect(hostSource).not.toContain("@kalada/language-service");
  });

  it("keeps the language-service source graph headless and evaluation-free", async () => {
    const sourceDirectory = resolve(languageService, "src");
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    const production = names.filter(
      (name) => !name.endsWith(".test.ts") && name !== "test-support.ts",
    );
    const source = (
      await Promise.all(production.map((name) => readFile(resolve(sourceDirectory, name), "utf8")))
    ).join("\n");
    expect(source).not.toMatch(/codemirror|vscode|json-rpc|node:fs|node:net|\.evaluate\s*\(/iu);
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports.filter((name) => name?.startsWith("@"))).toEqual(
      expect.arrayContaining(["@kalada/core", "@kalada/host", "@kalada/syntax"]),
    );
    expect(imports.every((name) => name?.startsWith(".") || name?.startsWith("@kalada/"))).toBe(
      true,
    );
  });

  it("keeps CodeMirror dependencies and translation logic in the adapter", async () => {
    const manifest = await readJson(resolve(codeMirror, "package.json"));
    expect(Object.keys(manifest.peerDependencies as object).sort()).toEqual([
      "@codemirror/autocomplete",
      "@codemirror/commands",
      "@codemirror/lint",
      "@codemirror/state",
      "@codemirror/view",
    ]);
    const sourceDirectory = resolve(codeMirror, "src");
    const source = (
      await Promise.all(
        (
          await readdir(sourceDirectory)
        )
          .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
          .map((name) => readFile(resolve(sourceDirectory, name), "utf8")),
      )
    ).join("\n");
    expect(source).not.toMatch(/parseKalada|editorGraph|evaluate\s*\(/u);
  });

  it("keeps DOM ambient types and imports out of headless packages", async () => {
    const rootConfig = await readJson(resolve(root, "tsconfig.json"));
    const rootCompiler = rootConfig.compilerOptions as { readonly lib?: readonly string[] };
    expect(rootCompiler.lib).toEqual(["ES2024"]);
    const codeMirrorConfig = await readJson(resolve(codeMirror, "tsconfig.json"));
    const codeMirrorCompiler = codeMirrorConfig.compilerOptions as {
      readonly lib?: readonly string[];
    };
    expect(codeMirrorCompiler.lib).toContain("DOM");
    for (const directory of [core, host, languageService]) {
      const config = await readJson(resolve(directory, "tsconfig.json"));
      const compiler = config.compilerOptions as { readonly lib?: readonly string[] };
      expect(compiler.lib).toBeUndefined();
      const source = await productionSource(resolve(directory, "src"));
      expect(source).not.toMatch(/from\s+["'](?:@codemirror\/|codemirror|@kalada\/codemirror)/u);
    }
  });

  it("keeps compiler, evaluator, and profile APIs off the root entry point", async () => {
    const source = await readFile(resolve(core, "src/index.ts"), "utf8");
    const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
    const text = file.getText();
    for (const forbidden of ["compileExpression", "evaluateCompiled", "ExpressionProfile"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("uses the continuation stack as the only evaluator call-stack authority", async () => {
    const state = await readFile(resolve(core, "src/kalada-v1/evaluation-state.ts"), "utf8");
    const delivery = await readFile(resolve(core, "src/kalada-v1/evaluation-delivery.ts"), "utf8");
    expect(state.match(/readonly stack:/gu)).toHaveLength(1);
    expect(state).not.toContain("readonly calls:");
    expect(delivery).not.toContain("calls.push");
    expect(delivery).not.toContain("calls.pop");
  });
});

async function productionSource(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return productionSource(path);
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return "";
      return readFile(path, "utf8");
    }),
  );
  return chunks.join("\n");
}

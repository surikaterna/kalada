import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
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
    ).toEqual(["adapter-scheman", "core", "host", "language-service", "projection", "syntax"]);
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

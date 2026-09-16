import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const core = resolve(root, "packages/core");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("package boundaries", () => {
  it("creates only the core package", async () => {
    const entries = await readdir(resolve(root, "packages"), { withFileTypes: true });
    expect(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([
      "core",
    ]);
  });

  it("keeps core free of runtime dependencies", async () => {
    const manifest = await readJson(resolve(core, "package.json"));
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      expect(manifest[field], field).toBeUndefined();
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
});

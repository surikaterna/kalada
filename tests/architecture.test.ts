import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const core = resolve(root, "packages/core");
const host = resolve(root, "packages/host");

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
    ).toEqual(["core", "host", "projection", "syntax"]);
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

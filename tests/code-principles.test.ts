import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "../packages/core/src");
const nestedKinds = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return paths.flat().filter((path) => [".ts", ".tsx"].includes(extname(path)));
}

function nestingDepth(node: ts.Node, depth = 0): number {
  const nextDepth = nestedKinds.has(node.kind) ? depth + 1 : depth;
  let maximum = nextDepth;
  node.forEachChild((child) => {
    maximum = Math.max(maximum, nestingDepth(child, nextDepth));
  });
  return maximum;
}

function functions(file: ts.SourceFile): ts.SignatureDeclaration[] {
  const found: ts.SignatureDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node)) found.push(node);
    node.forEachChild(visit);
  }
  file.forEachChild(visit);
  return found;
}

describe("production code principles", () => {
  it("limits file and function size and nesting", async () => {
    for (const path of await sourceFiles(sourceRoot)) {
      const text = await readFile(path, "utf8");
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      expect(text.split("\n").length, `${path} lines`).toBeLessThanOrEqual(400);
      for (const fn of functions(file)) {
        const lines =
          file.getLineAndCharacterOfPosition(fn.end).line -
          file.getLineAndCharacterOfPosition(fn.getStart(file)).line +
          1;
        expect(lines, `${path} function lines`).toBeLessThanOrEqual(50);
        expect(nestingDepth(fn), `${path} nesting`).toBeLessThanOrEqual(3);
      }
    }
  });
});

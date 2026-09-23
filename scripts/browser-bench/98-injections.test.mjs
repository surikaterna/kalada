import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inject } from "./98-injections.mjs";

const a = resolve(import.meta.dirname, "../../../98-a-readonly");
const targets = [
  "packages/syntax/src/parse.ts",
  "packages/language-service/src/service.ts",
  "packages/language-service/src/documents.ts",
  "packages/codemirror/src/highlight-extension.ts",
  "apps/demo/src/inspectors/artifacts.ts",
  "apps/demo/src/ui/app.ts",
  "apps/demo/src/live/runtime.ts",
];

describe("benchmark-only A source injection", () => {
  it.each(targets)("matches exactly the reviewed A entry points: %s", (target) => {
    const code = readFileSync(join(a, target), "utf8");
    expect(inject(code, target, "/trace.js")).toContain('import { trace } from "/trace.js";');
    expect(inject(code, target, "/trace.js")).not.toBe(code);
  });

  it("fails closed when the underlying source changes", () => {
    expect(() => inject("", targets[0], "/trace.js")).toThrow("injection mismatch");
    expect(inject("", "packages/host/src/index.ts", "/trace.js")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { injectB } from "./98-injections-b.mjs";

const b = resolve(import.meta.dirname, "../../../98-b-parse-sharing");
const targets = [
  "packages/syntax/src/parse.ts",
  "packages/language-service/src/service.ts",
  "packages/language-service/src/syntax-cache.ts",
  "packages/language-service/src/documents.ts",
  "packages/codemirror/src/highlight-extension.ts",
  "apps/demo/src/inspectors/artifacts.ts",
  "apps/demo/src/ui/app.ts",
  "apps/demo/src/live/runtime.ts",
];

describe("benchmark-only B source injection", () => {
  it.each(targets)("matches exactly the experimental B entry points: %s", (target) => {
    const code = readFileSync(join(b, target), "utf8");
    expect(injectB(code, target, "/trace.js")).toContain('import { trace } from "/trace.js";');
  });

  it("fails closed on a changed B call boundary", () => {
    expect(() => injectB("", "packages/language-service/src/syntax-cache.ts", "/trace.js")).toThrow(
      "B injection mismatch",
    );
    expect(injectB("", "packages/host/src/index.ts", "/trace.js")).toBeNull();
  });
});

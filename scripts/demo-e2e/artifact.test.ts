import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertNoSourceReferences } from "./artifact.js";
import { EXPECTED_INVENTORY } from "./artifact-inventory.js";
import type { ArtifactInventory } from "./types.js";

describe("final demo artifact source references", () => {
  it.each([
    "//# sourceMappingURL=index.js.map",
    "/*# sourceMappingURL=data:application/json;base64,e30= */",
    "//# sourceURL=virtual-demo.js",
    "const value = 1; /* sourceURL = hidden.js */",
  ])("rejects source reference %s", (source) => {
    expect(() => assertNoSourceReferences("artifact.js", source)).toThrow(
      "Source reference is forbidden",
    );
  });

  it("accepts runtime code without source references", () => {
    expect(() => assertNoSourceReferences("artifact.js", "const source = 'local';")).not.toThrow();
  });
});

describe("frozen demo artifact inventory", () => {
  const source = readFileSync(EXPECTED_INVENTORY, "utf8");
  const inventory = JSON.parse(source) as ArtifactInventory;

  it("contains the exact normalized four-file closure", () => {
    expect(inventory.base).toBe("/kalada/");
    expect(inventory.scope).toBe("bounded-observed-syntax-not-general-javascript-proof");
    expect(inventory.files).toHaveLength(4);
    expect(inventory.files.map(({ file }) => file)).toContain("index.html");
    expect(inventory.files.filter(({ file }) => file.endsWith(".js"))).toHaveLength(2);
    expect(inventory.files.filter(({ file }) => file.endsWith(".css"))).toHaveLength(1);
    expect(inventory.files.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(true);
  });

  it("contains no machine paths or volatile timestamps", () => {
    expect(source).not.toMatch(/\/home\/|[A-Z]:\\|createdAt|timestamp/iu);
  });
});

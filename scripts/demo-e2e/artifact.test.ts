import { describe, expect, it } from "vitest";
import { assertNoSourceReferences } from "./artifact.js";

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

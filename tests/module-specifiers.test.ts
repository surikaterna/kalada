import { describe, expect, it } from "vitest";
import { importsModule } from "./module-specifiers.js";

describe("language-service router import guard", () => {
  it("accepts other imports and router names only in comments or strings", () => {
    for (const source of [
      'import "@kalada/core";',
      'import thing from "@kalada/provider-routing-other";',
      'const text = "import \\"@kalada/provider-routing\\";";',
      '// import "@kalada/provider-routing";',
      '/* require("@kalada/provider-routing") */',
    ]) {
      expect(importsModule(source, "@kalada/provider-routing"), source).toBe(false);
    }
  });

  it("rejects router imports across static, type, and call forms", () => {
    for (const source of [
      'import "@kalada/provider-routing";',
      'import { route } from "@kalada/provider-routing";',
      'import type { Route } from "@kalada/provider-routing";',
      'export type { Route } from "@kalada/provider-routing";',
      'import("@kalada/provider-routing");',
      'require("@kalada/provider-routing");',
      'module.require("@kalada/provider-routing");',
      'import router = require("@kalada/provider-routing");',
      'type Route = import("@kalada/provider-routing").Route;',
      'import "@kalada/provider-routing/internal";',
    ]) {
      expect(importsModule(source, "@kalada/provider-routing"), source).toBe(true);
    }
  });
});

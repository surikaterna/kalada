import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kalada/adapter-scheman": resolve(
        import.meta.dirname,
        "packages/adapter-scheman/src/index.ts",
      ),
      "@kalada/core": resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@kalada/host": resolve(import.meta.dirname, "packages/host/src/index.ts"),
      "@kalada/syntax": resolve(import.meta.dirname, "packages/syntax/src/index.ts"),
    },
  },
});

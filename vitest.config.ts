import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kalada/core/kalada-v1": resolve(
        import.meta.dirname,
        "packages/core/src/kalada-v1/index.ts",
      ),
    },
  },
});

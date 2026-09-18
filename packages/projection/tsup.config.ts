import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["@kalada/core/kalada-v1"],
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  sourcemap: true,
  target: "node22",
  treeshake: true,
});

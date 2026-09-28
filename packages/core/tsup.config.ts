import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: { entry: "src/kalada-v1/index.ts", resolve: true },
  entry: ["src/index.ts"],
  format: ["cjs"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  sourcemap: true,
  target: "node22",
  treeshake: true,
});

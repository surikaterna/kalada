import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: [
    "@kalada/language-service",
    "@codemirror/autocomplete",
    "@codemirror/commands",
    "@codemirror/lint",
    "@codemirror/state",
    "@codemirror/view",
  ],
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});

import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inject } from "./98-injections.mjs";

const a = resolve(import.meta.dirname, "../../../98-a-readonly");
const vite = await import(pathToFileURL(join(a, "apps/demo/node_modules/vite/dist/node/index.js")));
const entry = join(import.meta.dirname, "98-fifty-entry.js");
const alias = Object.fromEntries(
  ["adapter-scheman", "codemirror", "core", "host", "language-service", "syntax"].map((pkg) => [
    `@kalada/${pkg}`,
    join(a, "packages", pkg, "src/index.ts"),
  ]),
);

function plugin(instrumented) {
  const seen = new Set();
  return {
    name: instrumented ? "98-source-injection" : "98-unmodified-source",
    enforce: "pre",
    transform(code, id) {
      if (id === entry) return code.replaceAll("/dist/index.js", "/src/index.ts");
      if (!instrumented) return null;
      const relative = id.replace(`${a}/`, "");
      const updated = inject(code, relative, join(import.meta.dirname, "98-trace.js"));
      if (updated) seen.add(relative);
      return updated;
    },
    buildEnd() {
      if (instrumented && !seen.has("packages/syntax/src/parse.ts")) {
        throw Error("syntax parse entry was not instrumented");
      }
    },
  };
}

async function build(instrumented, input, outDir, entryFileNames) {
  await vite.build({
    configFile: false,
    root: join(a, "apps/demo"),
    base: "/kalada/",
    plugins: [plugin(instrumented)],
    resolve: { alias },
    build: {
      outDir,
      emptyOutDir: true,
      modulePreload: { polyfill: false },
      ...(input ? { rollupOptions: { input, output: { entryFileNames } } } : {}),
    },
  });
}

await build(true, null, "/tmp/opencode/98-instrumented-dist");
await build(
  false,
  join(import.meta.dirname, "98-fifty-normal-entry.js"),
  "/tmp/opencode/98-ls-normal-dist",
  "98-fifty-normal.js",
);
await build(
  true,
  join(import.meta.dirname, "98-fifty-instrumented-entry.js"),
  "/tmp/opencode/98-ls-instrumented-dist",
  "98-fifty-instrumented.js",
);

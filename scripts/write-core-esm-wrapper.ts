import { copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCoreEsmWrapper } from "./core-esm-wrapper.js";

const core = resolve(import.meta.dirname, "../packages/core/dist");
await Promise.all([
  writeFile(resolve(core, "index.js"), createCoreEsmWrapper()),
  copyFile(resolve(core, "index.d.cts"), resolve(core, "index.d.ts")),
]);

import { createRequire } from "node:module";
import * as core from "@kalada/core";
import coreManifest from "@kalada/core/package.json" with { type: "json" };
import * as projection from "@kalada/projection";
import schema from "@kalada/projection/projection-v1.schema.json" with { type: "json" };
import * as syntax from "@kalada/syntax";

const require = createRequire(import.meta.url);
const cjs = {
  core: require("@kalada/core"),
  projection: require("@kalada/projection"),
  syntax: require("@kalada/syntax"),
};

for (const [name, esm, commonjs] of [
  ["core", core, cjs.core],
  ["projection", projection, cjs.projection],
  ["syntax", syntax, cjs.syntax],
]) {
  const esmKeys = Object.keys(esm).sort();
  const cjsKeys = Object.keys(commonjs).sort();
  if (JSON.stringify(esmKeys) !== JSON.stringify(cjsKeys)) {
    throw new Error(`${name} ESM/CJS surface mismatch`);
  }
}

for (const [name, value] of Object.entries(core)) {
  if (!Object.is(value, cjs.core[name])) throw new Error(`Core identity mismatch: ${name}`);
}
if (core.Option.none() !== cjs.core.Option.none())
  throw new Error("Core singleton identity mismatch");

const parsed = syntax.parseKaladaV1Expression("1 + 2");
const lowered = syntax.lowerKaladaV1Expression(parsed);
if (!lowered.ok) throw new Error("Syntax ESM execution failed");
const projected = projection.compileProjectionV1(
  projection.ProjectionV1.program(
    projection.ProjectionV1.value(core.KaladaV1.program(core.KaladaV1.literal("packed"))),
  ),
);
if (!projected.ok) throw new Error("Projection ESM execution failed");
if (coreManifest.name !== "@kalada/core" || !schema.$id) throw new Error("Metadata export failed");

for (const path of [
  "@kalada/core/dist/index.js",
  "@kalada/core/kalada-v1",
  "@kalada/syntax/dist/index.js",
  "@kalada/projection/dist/index.js",
]) {
  try {
    await import(path);
    throw new Error(`Internal ESM path resolved: ${path}`);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }
}

const resolutions = Object.fromEntries(
  ["@kalada/core", "@kalada/syntax", "@kalada/projection"].map((name) => [
    name,
    new URL(import.meta.resolve(name)).pathname.split("/node_modules/").at(-1),
  ]),
);
if (!Object.values(resolutions).every((path) => path?.endsWith("/dist/index.js"))) {
  throw new Error(`Unexpected ESM resolution: ${JSON.stringify(resolutions)}`);
}
console.log(`esm-resolution=${JSON.stringify(resolutions)}`);

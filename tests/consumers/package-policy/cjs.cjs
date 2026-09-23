const packages = ["@kalada/core", "@kalada/syntax", "@kalada/projection"];
const resolutions = {};
for (const name of packages) {
  resolutions[name] = require.resolve(name).split("/node_modules/").at(-1);
  if (!resolutions[name].endsWith("/dist/index.cjs")) {
    throw new Error(`Unexpected CJS resolution: ${name} -> ${resolutions[name]}`);
  }
  try {
    require(`${name}/dist/index.cjs`);
    throw new Error(`Internal CJS path resolved: ${name}`);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }
}
if (!require("@kalada/core").isResult(require("@kalada/core").Result.ok(1))) {
  throw new Error("Core CJS execution failed");
}
const syntax = require("@kalada/syntax");
if (!syntax.lowerKaladaV1Expression(syntax.parseKaladaV1Expression("true")).ok) {
  throw new Error("Syntax CJS execution failed");
}
if (typeof require("@kalada/projection").compileProjectionV1 !== "function") {
  throw new Error("Projection CJS execution failed");
}
console.log(`cjs-resolution=${JSON.stringify(resolutions)}`);

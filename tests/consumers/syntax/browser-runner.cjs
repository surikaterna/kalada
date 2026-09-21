const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const source = readFileSync("browser.js", "utf8");
const context = Object.create(null);
for (const name of ["Buffer", "process", "require", "module"]) {
  if (vm.runInNewContext(`typeof ${name}`, context) !== "undefined") {
    throw new Error(`${name} unexpectedly exists in the browser context`);
  }
}
vm.runInNewContext(source, context, { filename: "browser.js" });
const outcome = JSON.stringify(context.syntaxBrowserOutcome);
if (
  outcome !==
  '{"kind":"numeric-binary","resultType":{"kind":"primitive-type","name":"number"},"text":"(1 + 2) * 3"}'
) {
  throw new Error(`Isolated browser execution mismatch: ${outcome}`);
}

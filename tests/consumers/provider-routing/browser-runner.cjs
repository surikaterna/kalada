const fs = require("node:fs");
const vm = require("node:vm");

const context = { TextEncoder, TextDecoder };
vm.runInNewContext(fs.readFileSync("browser.js", "utf8"), context);
const result = context.packedRouterBrowserSmoke();
if (
  result.status !== "invalid" ||
  JSON.stringify(result.diagnostics) !==
    JSON.stringify([{ code: "DOMAIN_UNKNOWN_NAME", range: { start: 4, end: 9 } }])
)
  throw Error(`Domain browser bundle failed: ${JSON.stringify(result)}`);

const fs = require("node:fs");
const vm = require("node:vm");

const context = { TextEncoder, TextDecoder };
vm.runInNewContext(fs.readFileSync("browser.js", "utf8"), context);
const result = context.packedRouterBrowserSmoke();
if (result.status !== "supported") throw Error(`Browser bundle failed: ${JSON.stringify(result)}`);

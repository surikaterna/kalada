const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("browser.js", "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
if (!context.globalThis.languageServiceBrowserSmoke()) throw new Error("Browser smoke failed");

const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const context = Object.create(null);
vm.runInNewContext(readFileSync("browser.js", "utf8"), context, { filename: "browser.js" });
if (context.peerBrowserOutcome !== "passed") throw Error("VM browser composition failed");

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCliBatch } from "./session.mjs";

const root = import.meta.dirname;
const cli = join(root, "node_modules/.bin/playwright-cli");
const bundle = readFileSync("/tmp/opencode/98-fifty.js", "utf8");
const template = readFileSync(join(root, "98-fifty-page.js"), "utf8").trim().replace(/;$/, "");
const record = {};
const cliCall = (session, args) => {
  try {
    return execFileSync(cli, [`-s=${session}`, ...args], { encoding: "utf8", timeout: 120000 });
  } catch (error) {
    throw Error(`${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error}`);
  }
};
runCliBatch({
  session: `k98-${process.pid}`,
  record,
  cliCall,
  execute: (file) => {
    cliCall(`k98-${process.pid}`, [
      "open",
      "http://127.0.0.1:4179/kalada/",
      "--config",
      join(root, "cli.config.json"),
    ]);
    writeFileSync(file, template.replace("__BUNDLE__", JSON.stringify(bundle)));
    const output = cliCall(`k98-${process.pid}`, ["run-code", `--filename=${file}`]);
    const result = output.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/)?.[1];
    if (!result) throw Error(output);
    record.data = JSON.parse(result);
  },
});
writeFileSync("/tmp/opencode/98-fifty-results.json", JSON.stringify(record, null, 2));
if (record.failures?.length) throw Error(record.failures.join("; "));
console.log(
  "50 expression browser samples:",
  record.data.result.length,
  "browser:",
  record.data.browserVersion,
);

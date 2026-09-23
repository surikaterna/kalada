import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCliBatch } from "./session.mjs";

const root = import.meta.dirname;
const b = process.env.KALADA_98_STAGE_B === "1";
const cli = join(root, "node_modules/.bin/playwright-cli");
const template = readFileSync(join(root, "98-stage-page.js"), "utf8").trim().replace(/;$/, "");
const capture = readFileSync(join(root, "98-stage-capture.js"), "utf8").trim().replace(/;$/, "");
const config = {
  urls: {
    A: `http://127.0.0.1:${b ? 4201 : 4179}/kalada/`,
    instrumented: "http://127.0.0.1:4199/kalada/",
  },
  repetitions: Number(process.argv[2] ?? 20),
  fixtures: [
    { name: "typical", text: "data.count + 1" },
    { name: "token-heavy", text: `data.count${" + 1".repeat(40)}` },
    { name: "recovery", text: `data.${" + data.".repeat(25)}` },
    { name: "crlf-astral", text: '"🚀"\r\n' },
  ],
};
const record = {};
const session = `k98stage-${process.pid}`;
function cliCall(_, args) {
  try {
    return execFileSync(cli, [`-s=${session}`, ...args], {
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    throw Error(`${error.stdout?.slice(0, 5000)}\n${error.stderr}\n${error}`);
  }
}
runCliBatch({
  session,
  record,
  cliCall,
  execute: (file) => {
    cliCall(session, ["open", config.urls.A, "--config", join(root, "cli.config.json")]);
    writeFileSync(
      file,
      template.replace("__CONFIG__", JSON.stringify(config)).replace("__CAPTURE__", capture),
    );
    const output = cliCall(session, ["run-code", `--filename=${file}`]);
    const result = output.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/)?.[1];
    if (!result) throw Error(`missing result: ${output.slice(0, 5000)}`);
    record.data = JSON.parse(result);
  },
});
if (record.failures?.length) throw Error(record.failures.join("; "));
if (record.data.browser !== "154.0.8037.0" || record.data.blocked.length) {
  throw Error("managed browser or network isolation mismatch");
}
for (let index = 0; index < record.data.rows.length; index += 2) {
  const normal = record.data.rows[index];
  const traced = record.data.rows[index + 1];
  if (
    JSON.stringify(normal.before) !== JSON.stringify(traced.before) ||
    JSON.stringify(normal.after) !== JSON.stringify(traced.after)
  ) {
    throw Error(`output mismatch: ${normal.fixture}/${normal.iteration}`);
  }
  const parses = traced.events.filter(({ stage }) => stage === "parse");
  if (
    parses.length !== 5 ||
    parses.some(({ version, length }) => version !== 3 || length !== traced.after.text.length) ||
    ["highlight", "diagnostics", "prepared"].some(
      (caller) => parses.filter((event) => event.caller === caller).length !== 1,
    ) ||
    parses.filter((event) => event.caller === "inspector").length !== 2
  ) {
    throw Error(`parse attribution mismatch: ${normal.fixture}/${normal.iteration}`);
  }
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
for (const row of record.data.rows) {
  for (const key of ["before", "after"]) {
    const snapshot = row[key];
    row[key] = {
      status: snapshot.status,
      textLength: snapshot.text.length,
      textSha256: hash(snapshot.text),
      outputSha256: hash(snapshot.output),
      spansSha256: hash(snapshot.spans),
      diagnosticsSha256: hash(snapshot.diagnostics),
      inspectorSha256: hash(snapshot.inspector),
    };
  }
}
const artifact = JSON.stringify({ config, record });
writeFileSync("/tmp/opencode/98-stage-raw.json", artifact);
writeFileSync(
  join(root, `../../docs/performance/${b ? "98-b-stage-raw" : "98-stage-raw"}.jsonl`),
  `${artifact}\n`,
);
console.log(`captured ${record.data.rows.length} rows; browser ${record.data.browser}`);

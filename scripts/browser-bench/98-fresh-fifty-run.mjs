import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCliBatch } from "./session.mjs";

const root = import.meta.dirname;
const [cohort, source, sha, bundleFile] = process.argv.slice(2);
const sessions = Number(process.env.KALADA_98_SESSIONS ?? 21);
if (![1, 21].includes(sessions)) throw Error("sessions must be 1 (smoke) or 21 (calibration)");
if (!["A1", "B", "A2"].includes(cohort) || !source || !sha || !bundleFile) {
  throw Error("Usage: node 98-fresh-fifty-run.mjs A1|B|A2 source sha bundle-file");
}
if (
  execFileSync("git", ["-C", resolve(source), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
  sha
) {
  throw Error("source SHA drift");
}
const cli = join(root, "node_modules/.bin/playwright-cli");
const bundle = readFileSync(resolve(bundleFile), "utf8");
const template = readFileSync(join(root, "98-fresh-fifty-page.js"), "utf8")
  .trim()
  .replace(/;$/, "");
const capture = readFileSync(join(root, "98-fresh-fifty-capture.js"), "utf8")
  .trim()
  .replace(/;$/, "");
const output = join(root, `../../docs/performance/98-b-fifty-${cohort.toLowerCase()}-raw.jsonl`);
const records = [];
const manifest = {
  issue: 98,
  cohort,
  sha,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  cli: execFileSync(cli, ["--version"], { encoding: "utf8" }).trim(),
  browser: "154.0.8037.0",
  sessions,
  warmup: 1,
  source,
  bundleFile,
  lockSha256: createHash("sha256")
    .update(readFileSync(join(source, "bun.lock")))
    .digest("hex"),
  fixtureSha256: [false, true].map((heavy) => {
    const sources = Array.from({ length: 50 }, (_, index) =>
      heavy ? `1${" + 1".repeat(40)} + ${index}` : `1 + ${index}`,
    );
    return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  }),
  workload: "50 public-LS independent numeric expressions, no actual data/schema change",
};

function call(session, args) {
  try {
    return execFileSync(cli, [`-s=${session}`, ...args], { encoding: "utf8", timeout: 120000 });
  } catch (error) {
    throw Error(`${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error}`);
  }
}

for (let batch = 0; batch < sessions; batch += 1) {
  const session = `k98f-${cohort}-${process.pid}-${batch}`;
  const record = { batch, warmup: batch === 0 };
  runCliBatch({
    session,
    record,
    cliCall: call,
    execute: (file) => {
      call(session, [
        "open",
        "http://127.0.0.1:4179/kalada/",
        "--config",
        join(root, "cli.config.json"),
      ]);
      writeFileSync(
        file,
        template.replace("__BUNDLE__", JSON.stringify(bundle)).replace("__CAPTURE__", capture),
      );
      const log = call(session, ["run-code", `--filename=${file}`]);
      const value = log.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/)?.[1];
      if (!value) throw Error(`missing run-code result: ${log.slice(0, 1000)}`);
      record.data = JSON.parse(value);
    },
  });
  records.push(record);
  if (
    record.failures?.length ||
    record.data?.rows.length !== 2 ||
    record.data.browserVersion !== manifest.browser ||
    record.data.blocked.length !== 0 ||
    record.data.rows.some(
      (row) =>
        row.docs !== 50 ||
        row.diagnosticCode.length ||
        !row.currentness.coldCurrent ||
        row.currentness.oldVersionCurrent ||
        row.currentness.oldEnvironmentCurrent,
    )
  ) {
    throw Error(`${cohort}/${batch} failed: ${JSON.stringify(record.failures ?? record.data)}`);
  }
  writeFileSync(output, `${JSON.stringify({ manifest, records })}\n`);
  console.log(`${cohort} 50-doc ${batch + 1}/${sessions}: ok`);
}

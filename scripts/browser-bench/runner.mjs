import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = import.meta.dirname;
const cli = join(root, "node_modules/.bin/playwright-cli");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.split(/=(.*)/s).slice(0, 2)),
);
const url = args["--url"] ?? "http://127.0.0.1:4179/kalada/";
const artifact = resolve(args["--artifact"] ?? "../92-94-editor-usability/apps/demo/dist");
const source = resolve(args["--source"] ?? "../92-94-editor-usability");
const sha = args["--sha"] ?? "78d624f536d73db5ae813de5f64d8bd52fa07b29";
const batches = Number(args["--batches"] ?? 20);
const out = resolve(args["--out"] ?? "docs/performance/99-a-raw.json");
const cohort = args["--cohort"] ?? "A";
const command = (bin, ...argv) => execFileSync(bin, argv, { encoding: "utf8" }).trim();
const hash = (text) => createHash("sha256").update(text).digest("hex");
const resources = readdirSync(join(artifact, "assets"))
  .sort()
  .map((name) => ({
    name,
    sha256: hash(readFileSync(join(artifact, "assets", name))),
  }));
const browserExecutable = join(
  os.homedir(),
  ".cache/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell",
);
const fixtures = [
  { name: "typical", text: "data.count + 1" },
  { name: "many-tokens", text: `data.count${" + 1".repeat(40)}` },
  { name: "padded-valid", text: `data.count + 1${" ".repeat(60000)}` },
  { name: "recovery", text: `data.${" + data.".repeat(25)}` },
  { name: "crlf-astral", text: '"🚀"\r\n' },
].map((f) => ({
  ...f,
  sha256: hash(f.text),
  utf16Length: f.text.length,
  sourceCap: 65536,
  withinSourceCap: f.text.length + 1 <= 65536,
}));

if (!Number.isInteger(batches) || batches < 1 || batches > 100)
  throw Error("batches must be 1..100");
if (new URL(url).hostname !== "127.0.0.1") throw Error("loopback preview required");
if (command("git", "-C", source, "rev-parse", "HEAD") !== sha) throw Error("source SHA mismatch");
if (command("git", "-C", source, "status", "--porcelain", "--untracked-files=no"))
  throw Error("source worktree has tracked changes");
if (cohort === "A") {
  const pr = command("gh", "api", "repos/surikaterna/kalada/pulls/97", "--jq", ".head.sha");
  if (pr !== sha) throw Error(`PR #97 moved to ${pr}; update cohort metadata before measuring`);
}
const tokenProcess = spawnSync("bun", [join(root, "token-count.ts"), source], {
  input: JSON.stringify(fixtures.map((f) => f.text)),
  encoding: "utf8",
});
if (tokenProcess.status !== 0) throw Error(tokenProcess.stderr);
const tokenMeasurements = JSON.parse(tokenProcess.stdout);
fixtures.forEach((f, i) => {
  Object.assign(f, tokenMeasurements[i]);
});
const base = command("git", "rev-parse", "origin/main");
const closure = [
  { name: "index.html", sha256: hash(readFileSync(join(artifact, "index.html"))) },
  ...resources.map((r) => ({ ...r, name: `assets/${r.name}` })),
];
for (const entry of closure) {
  const target =
    entry.name === "index.html" ? url : new URL(`/assets/${entry.name.slice(7)}`, url).href;
  const response = await fetch(target);
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== entry.sha256)
    throw Error(`preview artifact mismatch: ${target}`);
}
const manifest = {
  issue: 99,
  cohort,
  sha,
  base,
  url,
  artifact,
  source,
  artifactIndexSha256: hash(readFileSync(join(artifact, "index.html"))),
  resources,
  lockSha256: hash(readFileSync(join(source, "bun.lock"))),
  cliLockSha256: hash(readFileSync(join(root, "package-lock.json"))),
  cliVersion: command(cli, "--version"),
  node: process.version,
  browserExecutable,
  browserVersion: command(browserExecutable, "--version"),
  bun: command("bun", "--version"),
  os: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0].model,
  locale: Intl.DateTimeFormat().resolvedOptions(),
  cache: "fresh non-persistent CLI session per batch; within-batch navigations warm HTTP cache",
  gc: "no forced GC; fresh browser each batch",
  throttle: "none",
  instrumentation: false,
  edit: "one trailing ASCII space; programmatic CodeMirror dispatch",
  fixtures,
};
const template = readFileSync(join(root, "in-page.js"), "utf8").trim().replace(/;$/, "");
const observations = [];
function cliCall(session, argv) {
  const result = spawnSync(cli, [`-s=${session}`, ...argv], { encoding: "utf8", timeout: 120000 });
  if (result.error || result.status !== 0)
    throw Error(`${result.error ?? result.status}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function outputCode(output) {
  try {
    const value = JSON.parse(output);
    return Array.isArray(value) ? value.map((d) => d.code) : value;
  } catch {
    return output;
  }
}
function checkResults(data) {
  const failures = data.results.flatMap((r, n) => {
    const f = fixtures[n];
    return r.after.text === `${f.text} ` &&
      r.afterDispatch === r.after.text &&
      r.before.text === f.text &&
      r.after.status &&
      !r.after.status.includes("LOADING") &&
      JSON.stringify(outputCode(r.before.output)) === JSON.stringify(outputCode(r.after.output)) &&
      !JSON.stringify(outputCode(r.after.output)).includes("KALADA_SYNTAX_LIMIT_EXCEEDED")
      ? []
      : [`${f.name}: output/text/status/limit mismatch`];
  });
  if (data.blocked.length) failures.push("blocked external requests");
  if (data.keyboard.text !== "data.user.name " || data.keyboard.output !== '"Ada"')
    failures.push("real keyboard typing failed");
  if (data.supersession.text !== "data.count + 1" || data.supersession.output !== "3")
    failures.push("rapid supersession stale output");
  return failures;
}
function compactResults(data) {
  for (const r of data.results) {
    for (const state of [r.before, r.after]) {
      state.textSha256 = hash(state.text);
      state.textLength = state.text.length;
      delete state.text;
      state.outputSha256 = hash(state.output ?? "");
      state.outputCode = outputCode(state.output);
      delete state.output;
    }
    r.after.markedTextSha256 = hash(r.after.markedText ?? "");
    delete r.after.markedText;
    r.afterDispatchSha256 = hash(r.afterDispatch);
    delete r.afterDispatch;
  }
}
function collect(session, record, i) {
  record.openLog = cliCall(session, ["open", url, "--config", join(root, "cli.config.json")]);
  const file = join(os.tmpdir(), `kalada-99-${process.pid}-${i}.js`);
  writeFileSync(
    file,
    template.replace("__CONFIG__", JSON.stringify({ url, origin: new URL(url).origin, fixtures })),
  );
  const runLog = cliCall(session, ["run-code", `--filename=${file}`]);
  record.runLogGzipBase64 = gzipSync(runLog).toString("base64");
  record.runLogSha256 = hash(runLog);
  record.requestLog = cliCall(session, ["requests", "--static"]);
  const result = runLog.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/)?.[1];
  if (!result) throw Error("CLI omitted run-code result");
  record.data = JSON.parse(result);
  record.failures = checkResults(record.data);
  compactResults(record.data);
}
for (let i = 0; i < batches; i++) {
  const session = `k99-${process.pid}-${i}`;
  const record = { batch: i, warmup: i === 0, session };
  try {
    collect(session, record, i);
  } catch (error) {
    record.failures = [...(record.failures ?? []), String(error)];
  } finally {
    try {
      record.closeLog = cliCall(session, ["close"]);
    } catch (error) {
      record.closeError = String(error);
    }
    observations.push(record);
    writeFileSync(out, `${JSON.stringify({ manifest, observations }, null, 2)}\n`);
    console.log(`${cohort} ${i + 1}/${batches}: ${record.failures?.join("; ") || "ok"}`);
  }
}
if (observations.some((r) => r.failures?.length)) process.exitCode = 1;

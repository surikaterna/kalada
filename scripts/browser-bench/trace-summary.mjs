import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [tracePath, networkPath, output] = process.argv.slice(2);
if (!tracePath || !networkPath || !output)
  throw Error("usage: node trace-summary.mjs TRACE NETWORK OUTPUT");
const trace = readFileSync(tracePath);
const network = readFileSync(networkPath);
if (/\/home\/|Bearer\s|Authorization\s*:/i.test(trace.toString("utf8")))
  throw Error("trace contains local path or credential marker; do not publish");
if (network.length) throw Error("unexpected network log; inspect before publishing");
const events = trace
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const counts = Object.fromEntries(
  [...new Set(events.map((event) => event.type))]
    .sort()
    .map((type) => [type, events.filter((event) => event.type === type).length]),
);
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
writeFileSync(
  output,
  `${JSON.stringify(
    {
      issue: 99,
      cohort: "A diagnostic only, outside timed sessions",
      sourceSha: "78d624f536d73db5ae813de5f64d8bd52fa07b29",
      cliVersion: "0.1.21",
      session: "k99-trace-20260923",
      trace: { localPath: tracePath, sha256: sha256(trace), bytes: trace.length },
      network: { localPath: networkPath, sha256: sha256(network), bytes: network.length },
      eventCounts: counts,
      browserName: events[0]?.browserName,
      playwrightVersionInCliTrace: events[0]?.playwrightVersion,
      safety:
        "Fresh non-persistent profile; synthetic built-in workspace only; no external requests; trace screened for paths/credential markers. Full trace ignored locally; regenerate to inspect snapshots.",
    },
    null,
    2,
  )}\n`,
);

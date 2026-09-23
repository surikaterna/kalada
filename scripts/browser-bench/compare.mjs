import { spawnSync } from "node:child_process";
import { summarize } from "./summarize.mjs";

// Both previews must already serve immutable production dist on distinct loopback ports.
const [aUrl, aArtifact, aSource, aSha, bUrl, bArtifact, bSource, bSha, prefix] =
  process.argv.slice(2);
if ([aUrl, aArtifact, aSource, aSha, bUrl, bArtifact, bSource, bSha, prefix].some((x) => !x))
  throw Error(
    "usage: node compare.mjs A_URL A_DIST A_SOURCE A_SHA B_URL B_DIST B_SOURCE B_SHA OUTPUT_PREFIX",
  );
const cohorts = [
  { label: "A1", url: aUrl, artifact: aArtifact, source: aSource, sha: aSha, cohort: "A" },
  { label: "B", url: bUrl, artifact: bArtifact, source: bSource, sha: bSha, cohort: "B" },
  { label: "A2", url: aUrl, artifact: aArtifact, source: aSource, sha: aSha, cohort: "A" },
];
const summaries = [];
for (const c of cohorts) {
  const path = `${prefix}-${c.label}.json`;
  const result = spawnSync(
    process.execPath,
    [
      new URL("./runner.mjs", import.meta.url).pathname,
      `--url=${c.url}`,
      `--artifact=${c.artifact}`,
      `--source=${c.source}`,
      `--sha=${c.sha}`,
      `--cohort=${c.cohort}`,
      `--batches=21`,
      `--out=${path}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw Error(`${c.label} failed; inspect ${path}`);
  summaries.push(summarize(path));
}
const [a1, b, a2] = summaries;
for (let i = 0; i < a1.rows.length; i++) {
  const signatures = [a1, b, a2].map((s) => JSON.stringify(s.rows[i].signatures));
  if (new Set(signatures).size !== 1 || [a1, b, a2].some((s) => s.valid < 20))
    throw Error(`equivalence or sample count failed: ${a1.rows[i].fixture}`);
}
console.log(
  JSON.stringify(
    {
      summaries,
      drift: a1.rows.map((row, i) => ({
        fixture: row.fixture,
        medianDispatchRatioA2toA1: a2.rows[i].dispatchMs.median / row.dispatchMs.median,
        medianRafRatioA2toA1: a2.rows[i].rafBoundaryMs.median / row.rafBoundaryMs.median,
      })),
      note: "Ratios are descriptive; review A1/A2 drift and dispersion before attributing B differences.",
    },
    null,
    2,
  ),
);

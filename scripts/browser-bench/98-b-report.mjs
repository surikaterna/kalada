import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../docs/performance");
const labels = ["A1", "B", "A2"];
const editor = labels.map((label) => {
  const input = `/tmp/opencode/98-${label.toLowerCase()}-editor.json`;
  const parsed = JSON.parse(readFileSync(input, "utf8"));
  if (parsed.observations.length !== 21 || parsed.observations.some((r) => r.failures?.length)) {
    throw Error(`invalid editor cohort: ${label}`);
  }
  writeFileSync(
    join(root, `98-b-editor-${label.toLowerCase()}-raw.jsonl`),
    `${JSON.stringify(parsed)}\n`,
  );
  return parsed;
});
const fifty = labels.map((label) =>
  JSON.parse(readFileSync(join(root, `98-b-fifty-${label.toLowerCase()}-raw.jsonl`), "utf8")),
);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
  const iqr = quantile(0.75) - quantile(0.25);
  return {
    n: sorted.length,
    median: (sorted[9] + sorted[10]) / 2,
    p95: quantile(0.95),
    iqr,
    outliers: sorted.filter((x) => x < quantile(0.25) - 1.5 * iqr || x > quantile(0.75) + 1.5 * iqr)
      .length,
  };
}

function summarizeEditor() {
  const fixtures = editor[0].manifest.fixtures.map((item) => item.name);
  return fixtures.map((name, index) => {
    const signatures = editor.flatMap((cohort) =>
      cohort.observations.slice(1).map((row) =>
        JSON.stringify({
          before: row.data.results[index].before,
          after: row.data.results[index].after,
        }),
      ),
    );
    if (new Set(signatures).size !== 1) throw Error(`editor parity mismatch: ${name}`);
    return {
      fixture: name,
      dispatch: editor.map((cohort) =>
        stats(cohort.observations.slice(1).map((row) => row.data.results[index].dispatchMs)),
      ),
    };
  });
}

function summarizeFifty() {
  return [0, 1].map((index) => {
    const signatures = fifty.flatMap((cohort) =>
      cohort.records.slice(1).map((record) =>
        JSON.stringify({
          output: record.data.rows[index].outputsSha256,
          tooling: record.data.rows[index].toolingSha256,
          currentness: record.data.rows[index].currentness,
        }),
      ),
    );
    if (new Set(signatures).size !== 1) throw Error(`50-doc parity mismatch: ${index}`);
    const phases = ["openMs", "editMs", "repeatMs", "envOnlyMs"];
    return {
      shape: index ? "token-heavy" : "arithmetic",
      phases: Object.fromEntries(
        phases.map((phase) => [
          phase,
          fifty.map((cohort) =>
            stats(cohort.records.slice(1).map((record) => record.data.rows[index][phase])),
          ),
        ]),
      ),
    };
  });
}

console.log(
  JSON.stringify(
    {
      labels,
      editor: summarizeEditor(),
      fifty: summarizeFifty(),
    },
    null,
    2,
  ),
);

import { readFileSync, writeFileSync } from "node:fs";

const percentile = (sorted, q) => sorted[Math.ceil(sorted.length * q) - 1];
export function summarize(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const good = raw.observations.filter((row) => !row.warmup && !row.failures?.length);
  const rows = raw.manifest.fixtures.map((fixture, index) => {
    const measurements = good.map((batch) => batch.data.results[index]);
    const signatures = [
      ...new Set(
        measurements.map((r) =>
          JSON.stringify({
            before: r.before.outputCode,
            after: r.after.outputCode,
            text: r.after.textSha256,
            status: r.after.status,
          }),
        ),
      ),
    ];
    const timing = (key) => {
      const values = measurements.map((m) => m[key]).sort((a, b) => a - b);
      if (!values.length) return null;
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      return {
        n: values.length,
        median,
        p95: percentile(values, 0.95),
        min: values[0],
        max: values.at(-1),
        spread: values.at(-1) - values[0],
        iqr: percentile(values, 0.75) - percentile(values, 0.25),
      };
    };
    return {
      fixture: fixture.name,
      signatures,
      dispatchMs: timing("dispatchMs"),
      rafBoundaryMs: timing("rafMs"),
      longTaskSupported: measurements.every((m) => m.longTaskSupported),
      longTaskCount: measurements.reduce((n, m) => n + m.longTasks.length, 0),
    };
  });
  return {
    cohort: raw.manifest.cohort,
    sha: raw.manifest.sha,
    batches: raw.observations.length,
    warmups: raw.observations.filter((r) => r.warmup).length,
    failures: raw.observations
      .filter((r) => r.failures?.length)
      .map((r) => ({ batch: r.batch, reasons: r.failures })),
    valid: good.length,
    rows,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const summary = summarize(process.argv[2]);
  if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(summary, null, 2)}\n`);
  else console.log(JSON.stringify(summary, null, 2));
}

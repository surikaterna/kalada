import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { summarize } from "./summarize.mjs";

test("warmup and failures excluded; median uses midpoint; p95 uses nearest rank", () => {
  const path = join(mkdtempSync(join(os.tmpdir(), "k99-summary-")), "raw.json");
  const row = (batch, failures = []) => ({
    batch,
    warmup: batch === 0,
    failures,
    data: {
      results: [
        {
          before: { outputCode: 3 },
          after: { outputCode: 3, textSha256: "abc", status: "ready" },
          dispatchMs: batch,
          rafMs: batch * 2,
          longTaskSupported: true,
          longTasks: [],
        },
      ],
    },
  });
  writeFileSync(
    path,
    JSON.stringify({
      manifest: { cohort: "A", sha: "sha", fixtures: [{ name: "test" }] },
      observations: [
        row(0),
        ...Array.from({ length: 20 }, (_, i) => row(i + 1)),
        row(99, ["failure"]),
      ],
    }),
  );
  const result = summarize(path);
  assert.equal(result.valid, 20);
  assert.equal(result.failures.length, 1);
  assert.equal(result.rows[0].dispatchMs.median, 10.5);
  assert.equal(result.rows[0].dispatchMs.p95, 19);
  assert.equal(result.rows[0].dispatchMs.iqr, 10);
});

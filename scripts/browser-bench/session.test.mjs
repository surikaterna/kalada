import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { calibrationBatches } from "./batches.mjs";
import { runCliBatch } from "./session.mjs";

test("calibration requires one warmup plus 20 independent measured batches", () => {
  assert.equal(calibrationBatches(), 21);
  assert.equal(calibrationBatches("21"), 21);
  assert.equal(calibrationBatches("1", true), 1);
  for (const value of ["0", "1", "20", "21.5", "NaN", "101"])
    assert.throws(() => calibrationBatches(value), /21\.\.100/);
});

test("on CLI failure, closes only its own session and removes owned run-code file", () => {
  let file;
  const commands = [];
  const record = {};
  runCliBatch({
    session: "k99-unit-test",
    record,
    cliCall(session, args) {
      commands.push([session, args]);
      throw Error("close failed");
    },
    execute(path) {
      file = path;
      writeFileSync(path, "synthetic");
      throw Error("run-code failed");
    },
  });
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(file.replace(/\/run-code\.js$/, "")), false);
  assert.deepEqual(commands, [["k99-unit-test", ["close"]]]);
  assert.match(record.failures.join(" "), /run-code failed.*close failed/);
});

test("successful batch still closes and removes its run-code file", () => {
  let file;
  const record = {};
  runCliBatch({
    session: "k99-success",
    record,
    cliCall: () => "closed",
    execute(path) {
      file = path;
      writeFileSync(path, "synthetic");
    },
  });
  assert.equal(existsSync(file), false);
  assert.equal(record.closeLog, "closed");
});

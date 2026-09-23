import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export function runCliBatch({ session, record, cliCall, execute }) {
  const directory = mkdtempSync(join(os.tmpdir(), "kalada-99-run-"));
  try {
    execute(join(directory, "run-code.js"));
  } catch (error) {
    record.failures = [...(record.failures ?? []), String(error)];
  } finally {
    try {
      record.closeLog = cliCall(session, ["close"]);
    } catch (error) {
      record.closeError = String(error);
      record.failures = [...(record.failures ?? []), `session close: ${error}`];
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

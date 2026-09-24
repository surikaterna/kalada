import { describe, expect, it } from "vitest";
import { Meter } from "./fixtures/host-profile.js";
import { recoverHost } from "./fixtures/host-recovery.js";
import { integratedTinyRecovery } from "./fixtures/integrated-tiny-recovery.js";
import { tinyGuest } from "./fixtures/tiny-guest.js";

describe("#131 independent integrated tiny grammar comparison", () => {
  it.each([
    "host{a}next{1}TAIL",
    'host{"}"}next{2}TAIL',
    "host{1 // comment}next{2}TAIL",
    "host{{1}next{2}TAIL",
  ])("marks Kalada-only or unsupported tiny lexical forms outside comparison: %s", (source) => {
    const snapshot = { source, version: 1, environment: "tiny" };
    const delegated = recoverHost({
      snapshot,
      current: snapshot,
      owner: "tiny",
      guest: tinyGuest,
      meter: new Meter({ work: 512, depth: 1, diagnostics: 3 }),
    });
    expect(delegated.status).toBe("unsupported");
    expect(delegated.attempts.map((item) => item.slot)).toEqual([1]);
    expect(delegated.ranges).toEqual([]);
    expect(integratedTinyRecovery(source).status).toBe("unsupported");
  });
  it.each([
    "host{12 + 34}next{5}TAIL",
    "🚀\r\nhost{ 12 }next{3\t+\t4}TAIL",
    "host{12}next{3 + }TAIL",
    "host{12}next{3 + ",
    "host{12 + }next{3}TAIL",
    "🚀\r\nhost{12 + }next{3}TAIL",
    "host{12}next{3}TAIL{broken",
  ])("compares status, stop, ownership, diagnostics and sibling entry: %s", (source) => {
    const snapshot = { source, version: 1, environment: "tiny" };
    const delegated = recoverHost({
      snapshot,
      current: snapshot,
      owner: "tiny",
      guest: tinyGuest,
      meter: new Meter({ work: 512, depth: 1, diagnostics: 3 }),
    });
    const integrated = integratedTinyRecovery(source);
    expect({
      status: delegated.status,
      stop: delegated.stop,
      ranges: delegated.ranges,
      attempts: delegated.attempts,
    }).toEqual(integrated);
  });
});

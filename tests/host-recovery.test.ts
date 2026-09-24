import { describe, expect, it } from "vitest";
import { Meter } from "./fixtures/host-profile.js";
import { type RecoveryRequest, recoverHost } from "./fixtures/host-recovery.js";
import { kaladaGuest } from "./fixtures/kalada-guest.js";
import { tinyGuest } from "./fixtures/tiny-guest.js";

function probe(source: string, overrides: Partial<RecoveryRequest> = {}) {
  const snapshot = { source, version: 1, environment: "fixture" };
  return recoverHost({
    snapshot,
    current: snapshot,
    owner: "kalada",
    guest: kaladaGuest,
    meter: new Meter({ work: 512, depth: 1, diagnostics: 3 }),
    ...overrides,
  });
}

describe("#131 declared two-slot recovery", () => {
  it("admits separately valid siblings with quoted brace and UTF16 prefix", () => {
    const source = '🚀\r\nhost{"}"}next{a + 1}TAIL';
    const result = probe(source);
    expect(result).toMatchObject({
      status: "valid",
      stop: source.lastIndexOf("}"),
      work: source.length,
      depth: 1,
      diagnostics: 0,
    });
    expect(result.ranges).toEqual([
      { start: 0, end: 9, owner: "host" },
      { start: 9, end: 12, owner: "kalada" },
      { start: 12, end: 18, owner: "host" },
      { start: 18, end: 23, owner: "kalada" },
      { start: 23, end: source.length, owner: "host" },
    ]);
  });

  it("records malformed first attempt but admits only the valid second island", () => {
    const source = "host{a + }next{b}TAIL";
    const result = probe(source);
    expect(result.status).toBe("partial");
    expect(result.attempts).toMatchObject([
      {
        slot: 1,
        stop: 9,
        diagnostics: [{ code: "KALADA_SYNTAX_EXPECTED_EXPRESSION", range: { start: 9, end: 9 } }],
      },
      { slot: 2, start: 15, diagnostics: [] },
    ]);
    expect(result.ranges.filter((range) => range.owner === "kalada")).toEqual([
      { start: 15, end: 16, owner: "kalada" },
    ]);
  });

  it.each([
    ["host{a // comment}next{b}TAIL", "unsupported"],
    ["host{{a}next{b}TAIL", "unsupported"],
    ['host{"unterminated}next{b}TAIL', "partial"],
    ["host{a next{b}TAIL", "unsupported"],
    ["host{a}wrong{b}TAIL", "partial"],
  ])("does not search for a sibling behind unsafe first close: %s", (source, status) => {
    const result = probe(source);
    expect(result.status).toBe(status);
    expect(result.attempts.map((item) => item.slot)).toEqual([1]);
    expect(result.ranges.filter((item) => item.owner === "kalada")).toEqual(
      source.includes("wrong") ? [{ start: 5, end: 6, owner: "kalada" }] : [],
    );
  });

  it("keeps incomplete second attempt distinct from admitted first", () => {
    const result = probe("host{a}next{b + ");
    expect(result.status).toBe("partial");
    expect(result.attempts.map((item) => item.slot)).toEqual([1, 2]);
    expect(result.ranges.filter((item) => item.owner === "kalada")).toEqual([
      { start: 5, end: 6, owner: "kalada" },
    ]);
  });

  it("uses one meter and stops before entering a sibling on exhausted budgets", () => {
    const source = "host{1 + }next{2}TAIL";
    for (const limits of [
      { work: 15, depth: 1, diagnostics: 3 },
      { work: 100, depth: 0, diagnostics: 3 },
      { work: 100, depth: 1, diagnostics: 0 },
      { work: 100, depth: 1, diagnostics: 1 },
    ]) {
      const meter = new Meter(limits);
      const result = probe(source, { meter });
      expect(result.status).toBe("budget");
      expect(result.work).toBeLessThanOrEqual(limits.work);
      expect(result.diagnostics).toBeLessThanOrEqual(limits.diagnostics);
      expect(result.ranges.some((item) => item.owner === "kalada")).toBe(false);
    }
  });

  it.each([false, true])(
    "does not inspect an unchecked million-character host tail (late brace: %s)",
    (lateBrace) => {
      const tail = `${"A".repeat(lateBrace ? 999_999 : 1_000_000)}${lateBrace ? "{" : ""}`;
      const source = `host{1}next{2}${tail}`;
      const result = probe(source, {
        owner: "tiny",
        guest: tinyGuest,
        meter: new Meter({ work: 16, depth: 1, diagnostics: 3 }),
      });
      expect(result).toMatchObject({ status: "budget", work: 16, stop: 13, ranges: [] });
      expect(result.attempts.map((item) => item.slot)).toEqual([1, 2]);
    },
  );

  it("charges connector bytes before reading them and does not enter an unbudgeted sibling", () => {
    let calls = 0;
    const source = "host{1}next{2}TAIL";
    const result = probe(source, {
      owner: "tiny",
      meter: new Meter({ work: 9, depth: 1, diagnostics: 3 }),
      guest: (text, start, meter) => {
        calls++;
        return tinyGuest(text, start, meter);
      },
    });
    expect(result).toMatchObject({ status: "budget", work: 9, ranges: [] });
    expect(result.attempts.map((item) => item.slot)).toEqual([1]);
    expect(calls).toBe(1);
  });

  it("keeps short valid TAIL and astral CRLF offsets on a shared exact budget", () => {
    const source = "🚀\r\nhost{1}next{2}TAIL";
    const result = probe(source, {
      owner: "tiny",
      guest: tinyGuest,
      meter: new Meter({ work: source.length, depth: 1, diagnostics: 3 }),
    });
    expect(result).toMatchObject({ status: "valid", work: source.length, stop: 17 });
    expect(result.attempts.map((item) => item.slot)).toEqual([1, 2]);
    expect(result.ranges).toEqual([
      { start: 0, end: 9, owner: "host" },
      { start: 9, end: 10, owner: "tiny" },
      { start: 10, end: 16, owner: "host" },
      { start: 16, end: 17, owner: "tiny" },
      { start: 17, end: source.length, owner: "host" },
    ]);
  });

  it("rejects stale/cancelled attempts and non-progress exits without sibling entry", () => {
    const source = "host{1}next{2}TAIL";
    const stale = {
      ...probeRequest(source),
      current: { source, version: 2, environment: "fixture" },
    };
    expect(recoverHost(stale).status).toBe("stale");
    expect(recoverHost({ ...probeRequest(source), cancelled: true }).status).toBe("cancelled");
    let calls = 0;
    const request = probeRequest(source);
    const result = recoverHost({
      ...request,
      guest: (text, start, meter) => {
        calls++;
        return { ...tinyGuest(text, start, meter), stop: start, range: { start, end: start } };
      },
    });
    expect(result.status).toBe("invalid");
    expect(calls).toBe(1);
    const mutated = probeRequest(source);
    const changing = recoverHost({
      ...mutated,
      guest: (text, start, meter) => {
        (mutated.snapshot as { environment: string }).environment = "changed";
        (mutated.current as { environment: string }).environment = "changed";
        return tinyGuest(text, start, meter);
      },
    });
    expect(changing).toMatchObject({ status: "stale", ranges: [], attempts: [] });
  });
});

function probeRequest(source: string): RecoveryRequest {
  const snapshot = { source, version: 1, environment: "fixture" };
  return {
    snapshot,
    current: snapshot,
    owner: "tiny",
    guest: tinyGuest,
    meter: new Meter({ work: 100, depth: 1, diagnostics: 3 }),
  };
}

import { describe, expect, it } from "vitest";
import { lowerKaladaV1Expression } from "../packages/syntax/src/lower.js";
import type { KaladaParseResult } from "../packages/syntax/src/public-types.js";
import { type GuestResult, Meter } from "./fixtures/host-profile.js";
import { type RecoveryRequest, recoverHost } from "./fixtures/host-recovery.js";
import { kaladaGuest } from "./fixtures/kalada-guest.js";
import { admissionProbe, admitPhase } from "./fixtures/phase-admission.js";

const zero = { lower: 0, emit: 0, edit: 0 };

describe("#132 test-local phase admission", () => {
  it("admits a lowerable quoted brace after an astral CRLF prefix and preserves UTF-16 ownership", () => {
    const source = '🚀\r\nhost{"}"}TAIL';
    const result = admitPhase(admissionProbe(source));
    expect(result.phases).toEqual([
      "captured",
      "dispatch-requested",
      "guest returned",
      "host validated",
      "phase admitted",
      "lowerable",
      "publishable",
    ]);
    expect(result.counters).toEqual({ lower: 1, emit: 1, edit: 1 });
    expect(result.outcome).toMatchObject({ status: "valid", stop: 12, work: source.length });
    expect(result.outcome.ranges).toEqual([
      { start: 0, end: 9, owner: "host" },
      { start: 9, end: 12, owner: "kalada" },
      { start: 12, end: source.length, owner: "host" },
    ]);
    expect(result.lowered).toMatchObject({ ok: true });
    if (result.lowered?.ok) {
      expect(
        result.lowered.sourceMap.some((item) => item.range.start === 9 && item.range.end === 12),
      ).toBe(true);
    }
  });

  it("rejects deserialized CST at the real lowering provenance boundary", () => {
    const parsed = kaladaGuest(
      'host{"}"}TAIL',
      5,
      new Meter({ work: 100, depth: 1, diagnostics: 3 }),
    ).parsed as KaladaParseResult;
    expect(lowerKaladaV1Expression(parsed).ok).toBe(true);
    const restored = JSON.parse(JSON.stringify(parsed)) as KaladaParseResult;
    expect(lowerKaladaV1Expression(restored)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_INVALID_INPUT" }],
    });
    expect("program" in lowerKaladaV1Expression(restored)).toBe(false);
    const result = admitPhase({
      ...admissionProbe('host{"}"}TAIL'),
      onReturn: (guest) => ({ ...guest, parsed: restored }),
    });
    expect(result.outcome.status).toBe("valid"); // host-only checks are insufficient
    expect(result.authentic).toBe(false);
    expect(result.counters).toEqual(zero);
  });

  it("does not publish a syntactically valid expression that cannot lower", () => {
    const result = admitPhase(admissionProbe('host{1 + "x"}TAIL'));
    expect(result.outcome.status).toBe("valid");
    expect(result.lowered?.ok).toBe(false);
    expect(result.phases).toEqual([
      "captured",
      "dispatch-requested",
      "guest returned",
      "host validated",
      "phase admitted",
    ]);
    expect(result.counters).toEqual({ lower: 1, emit: 0, edit: 0 });
  });

  it.each([
    [
      "stop at opener",
      (guest: GuestResult) => ({ ...guest, stop: 5, range: { start: 5, end: 5 } }),
    ],
    [
      "range mismatch",
      (guest: GuestResult) => ({ ...guest, range: { start: 0, end: guest.stop } }),
    ],
    [
      "forged delimiter",
      (guest: GuestResult) => ({
        ...guest,
        stop: guest.stop - 1,
        range: { start: 5, end: guest.stop - 1 },
      }),
    ],
    ["forged reason", (guest: GuestResult) => ({ ...guest, reason: "eof" })],
  ])("rejects %s before any action", (_name, onReturn) => {
    const result = admitPhase({ ...admissionProbe("host{1}TAIL"), onReturn });
    expect(result.counters).toEqual(zero);
    expect(result.phases).not.toContain("phase admitted");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["malformed range", { range: 1, diagnostics: [] }],
  ])("rejects callback return %s without admission or publication", (_name, value) => {
    const result = admitPhase({
      ...admissionProbe("host{1}TAIL"),
      onReturn: () => value as GuestResult,
    });
    expect(result.outcome.status).not.toBe("valid");
    expect(result.outcome.ranges).toEqual([]);
    expect(result.authentic).toBe(false);
    expect(result.counters).toEqual(zero);
    expect(result.phases).not.toContain("phase admitted");
    expect(result.phases).not.toContain("publishable");
  });

  it("does not fall back when a present callback is undefined or throws", () => {
    const probe = admissionProbe("host{1}TAIL");
    const cases = [
      { ...probe, onReturn: undefined },
      {
        ...probe,
        onReturn: () => {
          throw new Error("callback failed");
        },
      },
    ];
    for (const request of cases) {
      const result = admitPhase(request);
      expect(result.outcome.status).toBe("invalid");
      expect(result.outcome.ranges).toEqual([]);
      expect(result.counters).toEqual(zero);
      expect(result.phases).not.toContain("publishable");
    }
  });

  it.each([
    ["host{1 // comment}TAIL", "unsupported"],
    ["host{{1}TAIL", "partial"],
    ['host{"unterminated}TAIL', "partial"],
    ["host{1 + }TAIL", "partial"],
    ["host{1 + ", "partial"],
    ["host{1}TAIL{unsafe", "invalid"],
  ])("fails closed for %s", (source, status) => {
    const result = admitPhase(admissionProbe(source));
    expect(result.outcome.status).toBe(status);
    expect(result.outcome.ranges).toEqual([]);
    expect(result.counters).toEqual(zero);
  });

  it("rejects stale identity and cancellation on either side of the synchronous callback", () => {
    const source = "host{1}TAIL";
    for (const field of ["source", "version", "environment"] as const) {
      const probe = admissionProbe(source);
      probe.current = { ...probe.current, [field]: field === "version" ? 2 : "different" };
      const result = admitPhase(probe);
      expect(result.outcome.status).toBe("stale");
      expect(result.phases).toEqual(["captured"]);
      expect(result.counters).toEqual(zero);
    }
    expect(admitPhase({ ...admissionProbe(source), cancelled: true }).counters).toEqual(zero);
    for (const change of ["cancelled", "environment", "version", "source"] as const) {
      for (const target of ["snapshot", "current"] as const) {
        const result = admitPhase({
          ...admissionProbe(source),
          onReturn: (guest, request) => {
            if (change === "cancelled") request.cancelled = true;
            else
              (request[target] as { source: string; version: number; environment: string })[
                change
              ] = change === "version" ? 2 : "different";
            return guest;
          },
        });
        expect(result.outcome.status).toBe(change === "cancelled" ? "cancelled" : "stale");
        expect(result.counters).toEqual(zero);
      }
    }
  });

  it("records a dispatch request, not selection, for an undeclared host slot", () => {
    const result = admitPhase(admissionProbe("other{1}TAIL"));
    expect(result.phases).toEqual(["captured", "dispatch-requested"]);
    expect(result.outcome.status).toBe("invalid");
    expect(result.counters).toEqual(zero);
  });

  it.each([
    ["negative work", "work", -1000],
    ["NaN work", "work", NaN],
    ["overlimit work", "work", 6],
    ["negative depth", "depth", -1],
    ["overlimit diagnostics", "diagnostics", 4],
  ] as const)("rejects %s at entry", (_name, field, value) => {
    const meter = new Meter({ work: 5, depth: 1, diagnostics: 3 });
    meter[field] = value;
    const result = admitPhase({ ...admissionProbe("host{1}TAIL"), meter });
    expect(result.outcome.status).toBe("budget");
    expect(result.outcome.ranges).toEqual([]);
    expect(result.counters).toEqual(zero);
    expect(meter[field]).toBe(value);
  });

  it.each(["limits", "work"] as const)("rejects a throwing %s getter at entry", (field) => {
    const meter = new Meter({ work: 512, depth: 1, diagnostics: 3 });
    let reads = 0;
    Object.defineProperty(meter, field, {
      get() {
        reads++;
        throw new Error("hostile meter secret");
      },
    });
    const result = admitPhase({ ...admissionProbe("host{1}TAIL"), meter });
    expect(result.outcome).toMatchObject({
      status: "budget",
      reason: "invalid or mutated shared meter",
      ranges: [],
      work: 0,
      depth: 0,
      diagnostics: 0,
    });
    expect(reads).toBe(1);
    expect(result.authentic).toBe(false);
    expect(result.counters).toEqual(zero);
    expect(result.phases).not.toContain("guest returned");
    expect(result.phases).not.toContain("publishable");
  });

  it.each(["NaN limit", "malformed limits", "throwing limit field"] as const)(
    "rejects %s at entry",
    (kind) => {
      const meter = new Meter({ work: 512, depth: 1, diagnostics: 3 });
      if (kind === "NaN limit") (meter.limits as { work: number }).work = NaN;
      if (kind === "malformed limits") Object.defineProperty(meter, "limits", { value: null });
      if (kind === "throwing limit field")
        Object.defineProperty(meter.limits, "work", {
          get() {
            throw new Error("hostile limit secret");
          },
        });
      const result = admitPhase({ ...admissionProbe("host{1}TAIL"), meter });
      expect(result.outcome).toMatchObject({
        status: "budget",
        reason: "invalid or mutated shared meter",
        ranges: [],
      });
      expect(result.authentic).toBe(false);
      expect(result.counters).toEqual(zero);
    },
  );

  it.each(["limits", "work"] as const)(
    "rejects a throwing %s getter installed by the callback",
    (field) => {
      const meter = new Meter({ work: 512, depth: 1, diagnostics: 3 });
      let reads = 0;
      const result = admitPhase({
        ...admissionProbe("host{1}TAIL"),
        meter,
        onReturn: (guest) => {
          Object.defineProperty(meter, field, {
            get() {
              reads++;
              throw new Error("hostile meter secret");
            },
          });
          return guest;
        },
      });
      expect(result.outcome).toMatchObject({
        status: "budget",
        reason: "invalid or mutated shared meter",
        ranges: [],
        work: 0,
        depth: 0,
        diagnostics: 0,
      });
      expect(reads).toBe(1);
      expect(result.authentic).toBe(false);
      expect(result.counters).toEqual(zero);
      expect(result.phases).not.toContain("phase admitted");
      expect(result.phases).not.toContain("publishable");
    },
  );

  it.each([
    ["negative", -1000],
    ["NaN", NaN],
    ["overlimit", 1001],
    ["plausible forged count", 1],
  ])("rejects %s work mutation after the guest callback", (_name, value) => {
    const meter = new Meter({ work: 512, depth: 1, diagnostics: 3 });
    const result = admitPhase({
      ...admissionProbe("host{1}TAIL"),
      meter,
      onReturn: (guest) => {
        meter.work = value;
        return guest;
      },
    });
    expect(result.outcome.status).toBe("budget");
    expect(result.outcome.ranges).toEqual([]);
    expect(result.counters).toEqual(zero);
  });

  it.each(["depth", "diagnostics", "exhausted", "active", "limit"] as const)(
    "rejects callback mutation of %s",
    (field) => {
      const meter = new Meter({ work: 512, depth: 1, diagnostics: 3 });
      const result = admitPhase({
        ...admissionProbe("host{1}TAIL"),
        meter,
        onReturn: (guest) => {
          if (field === "depth") meter.depth = -1;
          if (field === "diagnostics") meter.diagnostics = NaN;
          if (field === "exhausted") meter.exhausted = true;
          if (field === "active") (meter as unknown as { active: number }).active = -1;
          if (field === "limit") (meter.limits as { work: number }).work = 1;
          return guest;
        },
      });
      expect(result.outcome.status).toBe("budget");
      expect(result.outcome.ranges).toEqual([]);
      expect(result.counters).toEqual(zero);
    },
  );

  it("accepts a valid shared meter without replacing it", () => {
    const meter = new Meter({ work: 100, depth: 1, diagnostics: 3 });
    const result = admitPhase({ ...admissionProbe("host{1}TAIL"), meter });
    expect(result.outcome.status).toBe("valid");
    expect(meter.work).toBe("host{1}TAIL".length);
    expect(result.counters).toEqual({ lower: 1, emit: 1, edit: 1 });
  });

  it.each([
    { work: 5, depth: 1, diagnostics: 3 },
    { work: 100, depth: 0, diagnostics: 3 },
    { work: 100, depth: 1, diagnostics: 0 },
    { work: 100, depth: 1, diagnostics: 1 },
  ])("rejects exhausted shared budget %j", (limits) => {
    const source = limits.diagnostics === 1 ? "host{1 + }TAIL" : "host{1}TAIL";
    const result = admitPhase({
      ...admissionProbe(source),
      meter: new Meter(limits),
    });
    expect(result.outcome.status).toBe(limits.diagnostics === 1 ? "partial" : "budget");
    expect(result.outcome.work).toBeLessThanOrEqual(limits.work);
    expect(result.counters).toEqual(zero);
  });

  it("does not publish a recovered sibling when the whole host remains partial", () => {
    const source = "host{1 + }next{2}TAIL";
    const snapshot = { source, version: 1, environment: "fixture" };
    const request: RecoveryRequest = {
      snapshot,
      current: snapshot,
      owner: "kalada",
      guest: kaladaGuest,
      meter: new Meter({ work: 100, depth: 1, diagnostics: 3 }),
    };
    const recovery = recoverHost(request);
    const counters = { ...zero };
    // Publication is whole-document gated, never inferred from one owner-tagged sibling.
    if (recovery.status === "valid") counters.emit++;
    expect(recovery).toMatchObject({ status: "partial", diagnostics: 1 });
    expect(recovery.attempts[0].diagnostics[0].range).toEqual({ start: 9, end: 9 });
    expect(recovery.ranges.filter((range) => range.owner === "kalada")).toEqual([
      { start: 15, end: 16, owner: "kalada" },
    ]);
    expect(counters).toEqual(zero);
  });
});

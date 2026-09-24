import { describe, expect, it } from "vitest";
import { parseGuestExpressionPrefix } from "../packages/syntax/src/guest-boundary.js";
import { lowerKaladaV1Expression, parseKaladaV1Expression } from "../packages/syntax/src/index.js";
import {
  compose,
  Meter,
  type Profile,
  type Request,
  type Snapshot,
} from "./fixtures/host-profile.js";

const profile: Profile = Object.freeze({ version: 1, position: "expression", allowed: ["kalada"] });

function request(source: string, overrides: Partial<Request> = {}): Request {
  const snapshot: Snapshot = Object.freeze({ source, version: 4, environment: "schema-A" });
  return {
    snapshot,
    current: snapshot,
    profiles: [profile],
    explicit: "kalada",
    budget: { work: 1000, depth: 1, diagnostics: 10 },
    ...overrides,
  };
}

describe("#127 one declared host slot (not full CF01)", () => {
  it.each([
    ['host{"}"}TAIL', '"}"'],
    ['host{("}" + 1)}\r\n🚀TAIL', '("}" + 1)'],
    ['🚀\r\nhost{("}" + 1)}TAIL', '("}" + 1)'],
    ["host{a ? (b + 1) : c}TAIL", "a ? (b + 1) : c"],
    ['host{a?.field ?? "x"}TAIL', 'a?.field ?? "x"'],
  ])("owns the return and continues host text for %s", (source, expression) => {
    const result = compose(request(source));
    const start = source.indexOf("{") + 1;
    const stop = start + expression.length;
    expect(result).toMatchObject({
      status: "valid",
      stop,
      depth: 1,
      diagnostics: 0,
      work: source.length,
    });
    expect(result.ranges).toEqual([
      { start: 0, end: start, owner: "host" },
      { start, end: stop, owner: "kalada" },
      { start: stop, end: source.length, owner: "host" },
    ]);
    expect(Object.isFrozen(result.ranges)).toBe(true);
    expect(result.guest?.parsed?.document.source).toBe(source);
    const parsed = result.guest?.parsed;
    if (!parsed) throw new Error("valid entry must have parsed guest");
    const actual = lowerKaladaV1Expression(parsed);
    const baseline = lowerKaladaV1Expression(parseKaladaV1Expression(expression));
    expect(actual.ok).toBe(baseline.ok);
    if (actual.ok && baseline.ok) {
      expect(actual.program).toEqual(baseline.program);
      expect(actual.sourceMap.map((entry) => entry.range)).toEqual(
        baseline.sourceMap.map((entry) => ({
          start: entry.range.start + start,
          end: entry.range.end + start,
        })),
      );
    }
    expect(source.slice(stop + 1)).toBe(source.slice(result.ranges[2].start + 1));
  });

  it("selects explicit before a static default, never guesses or falls back", () => {
    expect(compose(request("host{a}TAIL", { explicit: undefined })).status).toBe("unsupported");
    const withDefault = { ...profile, rootDefault: "kalada" };
    expect(
      compose(request("host{a}TAIL", { explicit: undefined, profiles: [withDefault] })).status,
    ).toBe("valid");
    expect(
      compose(request("host{a}TAIL", { explicit: "other", profiles: [withDefault] })).status,
    ).toBe("unsupported");
    const forbidden = { ...profile, rootDefault: "other" };
    expect(
      compose(request("host{a}TAIL", { explicit: undefined, profiles: [forbidden] })).status,
    ).toBe("unsupported");
  });

  it.each([
    ["host{a // comment}TAIL", "unsupported"],
    ["host{a /* } */}TAIL", "unsupported"],
    ["host{{a}TAIL", "partial"],
    ['host{"unterminated}TAIL', "partial"],
    ["host{(a}TAIL", "partial"],
    ["host{a + }TAIL", "partial"],
    ["host{a", "partial"],
    ["host{a}TAIL{broken", "invalid"],
  ])("fails closed and never exposes a valid range for %s", (source, status) => {
    const result = compose(request(source));
    expect(result.status).toBe(status);
    expect(result.ranges).toEqual([]);
  });

  it("rejects undeclared, overlapping, ambiguous, and unknown slots", () => {
    expect(compose(request("other{a}TAIL")).status).toBe("invalid");
    const source = "host{a}TAIL";
    expect(compose(request(source, { profiles: [profile, profile] })).status).toBe("invalid");
    const duplicate = { ...profile, allowed: ["kalada", "kalada"] };
    expect(compose(request(source, { profiles: [duplicate] })).status).toBe("invalid");
    const future = { ...profile, version: 2 as 1 };
    expect(compose(request(source, { profiles: [future] })).status).toBe("unsupported");
  });

  it("rejects stale versions, environments, source, and cancellation before guest invocation", () => {
    const source = "host{a}TAIL";
    for (const current of [
      { source, version: 5, environment: "schema-A" },
      { source, version: 4, environment: "schema-B" },
      { source: "host{b}TAIL", version: 4, environment: "schema-A" },
    ])
      expect(compose(request(source, { current })).status).toBe("stale");
    expect(compose(request(source, { cancelled: true })).status).toBe("cancelled");
  });

  it("rejects cancellation or environment mutation during a guest call", () => {
    const source = "host{a}TAIL";
    const cancel = { ...request(source), cancelled: false };
    cancel.guest = (text, start) => {
      cancel.cancelled = true;
      return parseGuestExpressionPrefix(text, start);
    };
    expect(compose(cancel).status).toBe("cancelled");
    const stale = { ...request(source), current: { ...request(source).current } };
    stale.guest = (text, start) => {
      stale.current = { ...stale.current, environment: "schema-B" };
      return parseGuestExpressionPrefix(text, start);
    };
    expect(compose(stale).status).toBe("stale");
  });

  it("validates injected guest returns rather than trusting a guest success bit", () => {
    const source = "host{a}TAIL";
    const genuine = compose(request(source)).guest;
    if (!genuine?.parsed) throw new Error("expected parsed guest");
    for (const guest of [
      { ...genuine, stop: 5 },
      { ...genuine, stop: source.length + 1 },
      { ...genuine, range: { start: 0, end: genuine.stop } },
      { ...genuine, reason: "eof" as const },
      { ...genuine, parsed: null },
      {
        ...genuine,
        parsed: { ...genuine.parsed, document: { ...genuine.parsed.document, source: "wrong" } },
      },
    ]) {
      const result = compose(request(source, { guest: () => guest }));
      expect(result.status).not.toBe("valid");
      expect(result.ranges).toEqual([]);
    }
  });

  it("accounts for shared entry, guest and host continuation work/depth/diagnostics", () => {
    const source = "host{a}TAIL";
    for (const budget of [
      { work: 5, depth: 1, diagnostics: 10 },
      { work: 1000, depth: 0, diagnostics: 10 },
      { work: source.length - 1, depth: 1, diagnostics: 10 },
      { work: 1000, depth: 1, diagnostics: 0 },
    ])
      expect(compose(request(source, { budget })).status).toBe("budget");
    const validGuest = compose(request(source)).guest;
    if (!validGuest) throw new Error("expected guest");
    const diagnostic = {
      phase: "parse" as const,
      code: "KALADA_SYNTAX_UNEXPECTED_TOKEN" as const,
      message: "error",
      range: { start: 6, end: 6 },
      path: [],
    };
    const malformed = compose(
      request(source, {
        guest: () => ({ ...validGuest, diagnostics: [diagnostic, diagnostic] }),
        budget: { work: 1000, depth: 1, diagnostics: 1 },
      }),
    );
    expect(malformed.status).toBe("budget");
    expect(malformed.ranges).toEqual([]);
  });

  it("shares one mutable meter with a nested toy host/guest without resetting any limit", () => {
    const outer = "host{a}TAIL";
    const inner = "host{a + }TAIL";
    const toy: NonNullable<Request["guest"]> = (source, start, meter) => {
      expect(meter).toBe(shared);
      const child = compose(request(inner, { meter }));
      expect(child.status).toBe("partial");
      return parseGuestExpressionPrefix(source, start);
    };
    const shared = new Meter({ work: 100, depth: 2, diagnostics: 2 });
    const done = compose(request(outer, { meter: shared, guest: toy }));
    expect(done).toMatchObject({ status: "partial", depth: 2, diagnostics: 1, ranges: [] });
    expect(done.work).toBe(outer.indexOf("}") + inner.indexOf("}"));
    expect(shared.work).toBe(done.work);
    const clean = new Meter({ work: 100, depth: 2, diagnostics: 2 });
    const nested = compose(
      request(outer, {
        meter: clean,
        guest: (source, start, same) => {
          expect(compose(request("host{b}TAIL", { meter: same })).status).toBe("valid");
          return parseGuestExpressionPrefix(source, start);
        },
      }),
    );
    expect(nested).toMatchObject({ status: "valid", depth: 2, diagnostics: 0 });
    expect(nested.work).toBe(outer.length + "host{b}TAIL".length);
    const diagnosticMeter = new Meter({ work: 100, depth: 2, diagnostics: 1 });
    let secondCalled = false;
    const exhausted = compose(
      request(outer, {
        meter: diagnosticMeter,
        guest: (source, start, same) => {
          expect(compose(request(inner, { meter: same })).diagnostics).toBe(1);
          const second = compose(
            request(inner, {
              meter: same,
              guest: (text, at) => {
                secondCalled = true;
                return parseGuestExpressionPrefix(text, at);
              },
            }),
          );
          expect(second.status).toBe("budget");
          return parseGuestExpressionPrefix(source, start);
        },
      }),
    );
    expect(secondCalled).toBe(false);
    expect(exhausted).toMatchObject({ status: "budget", diagnostics: 1, ranges: [] });

    for (const limits of [
      { work: 100, depth: 1, diagnostics: 2 },
      { work: outer.indexOf("}") + inner.indexOf("}") - 1, depth: 2, diagnostics: 2 },
      { work: 100, depth: 2, diagnostics: 0 },
    ]) {
      const meter = new Meter(limits);
      const calls: number[] = [];
      const result = compose(
        request(outer, {
          meter,
          guest: (source, start, same) => {
            calls.push(same.depth);
            compose(
              request(inner, {
                meter: same,
                guest: (text, at) => {
                  calls.push(same.depth);
                  return parseGuestExpressionPrefix(text, at);
                },
              }),
            );
            return parseGuestExpressionPrefix(source, start);
          },
        }),
      );
      expect(result.status).toBe("budget");
      expect(result.ranges).toEqual([]);
      expect(result.work).toBeLessThanOrEqual(limits.work);
      expect(result.diagnostics).toBeLessThanOrEqual(limits.diagnostics);
      if (limits.depth === 1) expect(calls).toEqual([1]);
      if (limits.diagnostics === 0) expect(calls).toEqual([]);
    }
  });

  it("never admits invalid guest parse for lowering; real lowerer rejects its diagnostics", () => {
    const source = "🚀\r\nhost{a + }TAIL";
    const start = 9;
    const parsed = parseGuestExpressionPrefix(source, start);
    expect(parsed).toMatchObject({ ok: false, reason: "outer-brace", stop: 13 });
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KALADA_SYNTAX_EXPECTED_EXPRESSION",
        range: { start: 13, end: 13 },
      }),
    );
    if (!parsed.parsed) throw new Error("expected real diagnostic CST");
    expect(lowerKaladaV1Expression(parsed.parsed).ok).toBe(false);
    const admitted = compose(request(source, { guest: () => parsed }));
    expect(admitted).toMatchObject({ status: "partial", stop: null, guest: null, ranges: [] });
  });

  it.each([
    ["🚀\r\nhost{a + }TAIL", "partial", "KALADA_SYNTAX_EXPECTED_EXPRESSION", 13, 13, 13],
    ["🚀\r\nhost{a // comment}TAIL", "unsupported", "KALADA_SYNTAX_UNSUPPORTED_FORM", 11, 11, 11],
    ["🚀\r\nhost{(a}TAIL", "partial", "KALADA_SYNTAX_EXPECTED_RIGHT_PARENTHESIS", 11, 11, 11],
  ] as const)(
    "reports absolute UTF16 stop and no host tail for %s",
    (source, status, code, start, end, stop) => {
      const result = compose(request(source));
      const guest = parseGuestExpressionPrefix(source, 9);
      expect(result).toMatchObject({ status, stop: null, guest: null, ranges: [] });
      expect(guest.stop).toBe(stop);
      expect(guest.stop).toBeGreaterThan(9);
      expect(guest.range).toEqual({ start: 9, end: stop });
      expect(guest.diagnostics).toContainEqual(
        expect.objectContaining({ code, range: { start, end } }),
      );
      expect(guest.diagnostics.every((item) => item.range.end <= stop)).toBe(true);
      expect(guest.parsed?.document.source).toBe(source);
    },
  );

  it("rejects invalid and unsupported selection before invoking guest or consuming host tail", () => {
    const source = "🚀\r\nhost{a}TAIL";
    let calls = 0;
    const guest: NonNullable<Request["guest"]> = (text, start) => {
      calls++;
      return parseGuestExpressionPrefix(text, start);
    };
    for (const overrides of [
      { profiles: [profile, profile] },
      { explicit: "other" },
      { profiles: [{ ...profile, version: 2 as 1 }] },
    ]) {
      expect(compose(request(source, { guest, ...overrides }))).toMatchObject({
        stop: null,
        guest: null,
        ranges: [],
        work: 0,
      });
    }
    expect(calls).toBe(0);
  });
});

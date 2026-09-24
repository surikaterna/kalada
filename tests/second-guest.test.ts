import { describe, expect, it } from "vitest";
import { compose, Meter, type Request } from "./fixtures/host-profile.js";
import { integratedTiny } from "./fixtures/integrated-tiny.js";
import { kaladaGuest } from "./fixtures/kalada-guest.js";
import { tinyGuest } from "./fixtures/tiny-guest.js";
import { runTiny } from "./fixtures/tiny-only.js";

function reverse(source: string, overrides: Partial<Request> = {}): Request {
  const snapshot = { source, version: 2, environment: "reverse" };
  return {
    snapshot,
    current: snapshot,
    profiles: [{ version: 1, position: "reverse", allowed: ["kalada"], rootDefault: "kalada" }],
    guests: { kalada: kaladaGuest, tiny: tinyGuest },
    budget: { work: 256, depth: 2, diagnostics: 2 },
    ...overrides,
  };
}

describe("#128 independent guest and explicit reverse host profile", () => {
  it("uses the same host selection and ownership path for a tiny-only consumer", () => {
    const source = "host{12 + ٣}TAIL";
    expect(runTiny(source)).toMatchObject({ status: "unsupported", ranges: [] });
    const good = "host{12 + 34}TAIL";
    expect(runTiny(good)).toMatchObject({
      status: "valid",
      stop: 12,
      work: good.length,
      ranges: [
        { start: 0, end: 5, owner: "host" },
        { start: 5, end: 12, owner: "tiny" },
        { start: 12, end: good.length, owner: "host" },
      ],
    });
    expect(runTiny("host{12 + }TAIL")).toMatchObject({ status: "partial", ranges: [] });
    expect(
      tinyGuest("🚀\r\n12 + }", 5, new Meter({ work: 30, depth: 1, diagnostics: 2 })).diagnostics,
    ).toEqual([{ code: "TINY_EXPECTED_DECIMAL", range: { start: 9, end: 9 } }]);
  });

  it("charges each tiny scan step before reading beyond shared work, including long digits and arrays", () => {
    for (const body of ["1".repeat(1_000_000), "1+".repeat(500_000)]) {
      const source = `host{${body}}TAIL`;
      const standaloneMeter = new Meter({ work: 6, depth: 1, diagnostics: 2 });
      expect(tinyGuest(source, 5, standaloneMeter)).toMatchObject({
        ok: false,
        reason: "limit",
        stop: 11,
        range: { start: 5, end: 11 },
        chargedWork: 6,
      });
      expect(standaloneMeter.work).toBe(6);
      const meter = new Meter({ work: 6, depth: 1, diagnostics: 2 });
      meter.advance(5);
      const direct = tinyGuest(source, 5, meter);
      expect(direct).toMatchObject({
        ok: false,
        reason: "limit",
        stop: 6,
        range: { start: 5, end: 6 },
        chargedWork: 1,
        diagnostics: [{ code: "TINY_EXPECTED_DECIMAL", range: { start: 6, end: 6 } }],
      });
      expect(meter.work).toBe(6);
      const composed = compose({
        ...reverse(source),
        profiles: [{ version: 1, position: "expression", allowed: ["tiny"] }],
        explicit: "tiny",
        budget: { work: 6, depth: 1, diagnostics: 2 },
      });
      expect(composed).toMatchObject({
        status: "budget",
        stop: null,
        guest: null,
        ranges: [],
        work: 6,
        depth: 1,
        diagnostics: 0,
      });
    }
  });

  it("does not reset shared work after nested tiny entry or bypass depth/diagnostic limits", () => {
    const source = `host{${"7".repeat(1_000_000)}}TAIL`;
    const base = reverse(source, {
      explicit: "tiny",
      profiles: [{ version: 1, position: "expression", allowed: ["tiny"] }],
    });
    const meter = new Meter({ work: 12, depth: 2, diagnostics: 2 });
    const nested = compose({
      ...base,
      meter,
      guest: (text, start, shared) => {
        const child = compose({ ...base, meter: shared });
        expect(child).toMatchObject({ status: "budget", work: 12, depth: 2, ranges: [] });
        return tinyGuest(text, start, shared);
      },
    });
    expect(nested).toMatchObject({ status: "budget", work: 12, depth: 2, ranges: [] });
    expect(compose({ ...base, budget: { work: 12, depth: 0, diagnostics: 2 } })).toMatchObject({
      status: "budget",
      work: 5,
      depth: 0,
      ranges: [],
    });
    expect(compose({ ...base, budget: { work: 12, depth: 1, diagnostics: 0 } })).toMatchObject({
      status: "budget",
      work: 5,
      depth: 0,
      diagnostics: 0,
      ranges: [],
    });
  });

  it("selects either registered guest at one allowed position without trying the other", () => {
    const source = "host{12 + 34}TAIL";
    const snapshot = { source, version: 1, environment: "both" };
    const base: Request = {
      snapshot,
      current: snapshot,
      profiles: [
        { version: 1, position: "expression", allowed: ["kalada", "tiny"], rootDefault: "tiny" },
      ],
      guests: { tiny: tinyGuest, kalada: kaladaGuest },
      budget: { work: 100, depth: 1, diagnostics: 2 },
    };
    expect(compose(base).ranges[1].owner).toBe("tiny");
    expect(compose({ ...base, explicit: "kalada" }).ranges[1].owner).toBe("kalada");
    expect(compose({ ...base, explicit: "missing" })).toMatchObject({
      status: "unsupported",
      work: 0,
      ranges: [],
    });
    expect(compose({ ...base, profiles: [...base.profiles, ...base.profiles] })).toMatchObject({
      status: "invalid",
      work: 0,
      ranges: [],
    });
  });

  it("compares a strict integrated tiny-host fixture with delegation and records incomplete sibling", () => {
    for (const source of ["host{12 + 34}TAIL", "host{12 + 34}TAIL{broken"]) {
      const integrated = integratedTiny(source);
      const delegated = runTiny(source);
      expect(delegated.status).toBe(integrated.status);
      expect(delegated.stop).toBe(integrated.stop);
      expect(delegated.ranges.map(({ start, end }) => [start, end])).toEqual(integrated.ranges);
      expect(delegated.status === "valid" ? [] : ["MALFORMED_DOCUMENT"]).toEqual(integrated.errors);
    }
  });

  it("allows reverse entry only with its matching declared position and permitted guest", () => {
    const source = "tiny<host{a + 1}>TAIL";
    expect(compose(reverse(source))).toMatchObject({ status: "valid", depth: 1 });
    expect(compose(reverse(source, { explicit: "tiny" })).status).toBe("unsupported");
    expect(
      compose(
        reverse(source, {
          explicit: "toString",
          profiles: [{ version: 1, position: "reverse", allowed: ["toString"] }],
        }),
      ).status,
    ).toBe("unsupported");
    expect(
      compose(
        reverse(source, {
          profiles: [{ version: 1, position: "expression", allowed: ["kalada"] }],
        }),
      ).status,
    ).toBe("invalid");
    expect(compose(reverse("tiny<host{a + 1}TAIL"))).toMatchObject({
      status: "invalid",
      ranges: [],
    });
    expect(compose(reverse("tiny<host{a + 1}>TAIL{broken")).status).toBe("invalid");
  });

  it("shares work/depth/diagnostics through host -> tiny -> host -> Kalada", () => {
    const source = "host{12}TAIL";
    const meter = new Meter({ work: 100, depth: 2, diagnostics: 2 });
    const result = compose({
      ...reverse(source),
      meter,
      explicit: "tiny",
      profiles: [{ version: 1, position: "expression", allowed: ["tiny"] }],
      guest: (text, start, shared) => {
        expect(shared).toBe(meter);
        expect(compose(reverse("tiny<host{a + 1}>TAIL", { meter: shared })).status).toBe("valid");
        return tinyGuest(text, start, shared);
      },
    });
    expect(result).toMatchObject({
      status: "valid",
      depth: 2,
      diagnostics: 0,
      work: source.length + "tiny<host{a + 1}>TAIL".length,
    });
    const limited = new Meter({ work: 100, depth: 1, diagnostics: 2 });
    const blocked = compose({
      ...reverse(source),
      meter: limited,
      explicit: "tiny",
      profiles: [{ version: 1, position: "expression", allowed: ["tiny"] }],
      guest: (text, start, shared) => {
        expect(compose(reverse("tiny<host{a + 1}>TAIL", { meter: shared })).status).toBe("budget");
        return tinyGuest(text, start, shared);
      },
    });
    expect(blocked).toMatchObject({ status: "budget", ranges: [] });
    const diagnosticMeter = new Meter({ work: 100, depth: 2, diagnostics: 1 });
    const dirty = compose({
      ...reverse("tiny<host{a}>TAIL"),
      meter: diagnosticMeter,
      guest: (text, start, shared) => {
        expect(
          compose({
            ...reverse("host{12 + }TAIL"),
            meter: shared,
            profiles: [{ version: 1, position: "expression", allowed: ["tiny"] }],
            explicit: "tiny",
          }),
        ).toMatchObject({ status: "partial", diagnostics: 1 });
        return kaladaGuest(text, start, shared);
      },
    });
    expect(dirty).toMatchObject({ status: "budget", diagnostics: 1, ranges: [] });
  });

  it("rejects spoofed counters, overlap and stale/cancelled returns", () => {
    const source = "tiny<host{a}>TAIL";
    const altered = compose(
      reverse(source, {
        guest: (text, start, meter) => {
          meter.work = -1;
          return kaladaGuest(text, start, meter);
        },
      }),
    );
    expect(altered.status).toBe("budget");
    expect(
      compose(
        reverse(source, {
          guest: (text, start, meter) => {
            meter.leave();
            return kaladaGuest(text, start, meter);
          },
        }),
      ).status,
    ).toBe("budget");
    const genuine = kaladaGuest(source, 10, new Meter({ work: 100, depth: 2, diagnostics: 2 }));
    expect(
      compose(
        reverse(source, { guest: () => ({ ...genuine, range: { start: 9, end: genuine.stop } }) }),
      ).status,
    ).toBe("invalid");
    const cancelling = { ...reverse(source), cancelled: false };
    cancelling.guest = (text, start, meter) => {
      cancelling.cancelled = true;
      return kaladaGuest(text, start, meter);
    };
    expect(compose(cancelling).status).toBe("cancelled");
    expect(
      compose(reverse(source, { current: { source, version: 3, environment: "reverse" } })).status,
    ).toBe("stale");
  });
});

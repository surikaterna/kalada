import { describe, expect, it } from "vitest";
import {
  type CompositionGuest,
  type CompositionRequest,
  createCompositionRouter,
} from "./index.js";

const text = '🚀\r\nhost{"}" bad}next{ok}';
const first = text.indexOf("{");
const second = text.indexOf("{ok}");
const close = text.indexOf("}next{");
const snapshot = { uri: "file:///recovery", text, version: 1, environmentGeneration: "env" };
const profile = {
  version: 1 as const,
  hostLanguageId: "host",
  position: "expr",
  open: "{",
  close: "}",
  allowedGuests: ["tiny"],
  defaultGuest: "tiny",
};
const guest: CompositionGuest = {
  languageId: "tiny",
  parse({ start, meter }) {
    meter.charge(start === first + 1 ? close - start : 2);
    if (start === first + 1)
      return {
        owner: "tiny",
        status: "partial",
        range: { start, end: close },
        stop: close,
        reason: "safe-host-close",
        diagnostics: [{ owner: "tiny", code: "BAD", range: { start: close - 3, end: close } }],
        subtree: { forbidden: true },
      };
    return {
      owner: "tiny",
      status: "valid",
      range: { start, end: start + 2 },
      stop: start + 2,
      reason: "host-close",
      diagnostics: [],
      subtree: { kind: "tiny" },
    };
  },
};
const router = createCompositionRouter([profile], [guest]);
const request = (override: Partial<CompositionRequest> = {}): CompositionRequest => ({
  snapshot,
  hostLanguageId: "host",
  slots: [
    { position: "expr", start: first },
    { position: "expr", start: second },
  ],
  isCurrent: () => true,
  limits: { work: 100, depth: 4, diagnostics: 10 },
  hostContinuation: {
    validate({ snapshot, close: marker, nextSlot, meter }) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(nextSlot)).toBe(true);
      expect(snapshot.text.slice(marker.start, nextSlot.start)).toBe("}next");
      meter.charge(nextSlot.start - marker.end);
      return { owner: "host", range: { start: marker.end, end: nextSlot.start } };
    },
  },
  ...override,
});

describe("non-authoritative partial recovery", () => {
  const tripleText = "🚀\r\n{x}n{y}n{z}";
  const starts = [
    tripleText.indexOf("{x}"),
    tripleText.indexOf("{y}"),
    tripleText.indexOf("{z}"),
  ] as const;
  const tripleSlots = starts.map((start) => ({ position: "expr", start }));
  const tripleSnapshot = { ...snapshot, text: tripleText };
  const tripleGuest = createCompositionRouter(
    [profile],
    [
      {
        languageId: "tiny",
        parse({ start, meter }) {
          meter.charge(1);
          const partial = start !== starts[2] + 1;
          return {
            owner: "tiny",
            status: partial ? "partial" : "valid",
            range: { start, end: start + 1 },
            stop: start + 1,
            reason: partial ? "safe-host-close" : "host-close",
            diagnostics: partial
              ? [{ owner: "tiny", code: "BAD", range: { start, end: start + 1 } }]
              : [],
            subtree: partial ? undefined : { kind: "third" },
          };
        },
      },
    ],
  );
  const tripleRequest = (override: Partial<CompositionRequest> = {}): CompositionRequest => ({
    ...request(),
    snapshot: tripleSnapshot,
    slots: tripleSlots,
    hostContinuation: {
      validate({ close: marker, nextSlot, meter }) {
        meter.charge(nextSlot.start - marker.end);
        return { owner: "host", range: { start: marker.end, end: nextSlot.start } };
      },
    },
    ...override,
  });
  it("continues across two proven partials to the valid third candidate with cumulative evidence", () => {
    const result = tripleGuest.compose(tripleRequest());
    expect(result).toMatchObject({
      status: "partial",
      attempts: [
        { status: "partial", range: { start: starts[0] + 1 } },
        { status: "partial", range: { start: starts[1] + 1 } },
      ],
      candidates: [{ owner: "tiny", range: { start: starts[2] + 1, end: starts[2] + 2 } }],
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.tree).toBeUndefined();
    expect(
      tripleGuest.compose(tripleRequest({ limits: { work: 11, depth: 4, diagnostics: 10 } }))
        .status,
    ).toBe("budget");
    expect(
      tripleGuest.compose(tripleRequest({ limits: { work: 100, depth: 4, diagnostics: 1 } }))
        .status,
    ).toBe("budget");
  });
  it("stops before the third slot on cancellation after the second callback", () => {
    let cancelled = false;
    let calls = 0;
    const result = tripleGuest.compose(
      tripleRequest({
        isCancelled: () => cancelled,
        hostContinuation: {
          validate({ close: marker, nextSlot, meter }) {
            calls++;
            if (calls === 2) cancelled = true;
            meter.charge(nextSlot.start - marker.end);
            return { owner: "host", range: { start: marker.end, end: nextSlot.start } };
          },
        },
      }),
    );
    expect(result.status).toBe("cancelled");
    expect(result.candidates).toBeUndefined();
    expect(calls).toBe(2);
  });
  it("does not skip an unsafe second partial to reach the third slot", () => {
    let parsedThird = false;
    const unsafe = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse({ start, meter }) {
            meter.charge(1);
            if (start === starts[2] + 1) parsedThird = true;
            return {
              owner: "tiny",
              status: "partial",
              range: { start, end: start + 1 },
              stop: start + 1,
              reason: start === starts[1] + 1 ? "eof" : "safe-host-close",
              diagnostics: [],
            };
          },
        },
      ],
    );
    const result = unsafe.compose(tripleRequest());
    expect(result).toMatchObject({
      status: "partial",
      attempts: [{ status: "partial" }, { status: "partial" }],
      candidates: [],
    });
    expect(parsedThird).toBe(false);
  });
  it("rejects declarations inside admitted candidates or attempts and out-of-order or duplicate slots", () => {
    const validSecond = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            input.meter.charge(1);
            if (input.start === starts[0] + 1)
              return {
                owner: "tiny",
                status: "partial",
                range: { start: input.start, end: input.start + 1 },
                stop: input.start + 1,
                reason: "safe-host-close",
                diagnostics: [],
              } as const;
            return {
              owner: "tiny",
              status: "valid",
              range: { start: input.start, end: input.start + 1 },
              stop: input.start + 1,
              reason: "host-close",
              diagnostics: [],
              subtree: {},
            };
          },
        },
      ],
    );
    for (const slots of [
      [
        { position: "expr", start: starts[0] },
        { position: "expr", start: starts[1] },
        { position: "expr", start: starts[1] + 1 },
      ],
      [
        { position: "expr", start: starts[0] },
        { position: "expr", start: starts[1] },
        { position: "expr", start: starts[0] + 1 },
      ],
      [
        { position: "expr", start: starts[0] },
        { position: "expr", start: starts[1] },
        { position: "expr", start: starts[1] },
      ],
    ]) {
      const result = validSecond.compose(tripleRequest({ slots }));
      expect(result.status).toBe("invalid");
      expect(result.candidates).toBeUndefined();
      expect(result.tree).toBeUndefined();
    }
    const attemptOverlap = tripleGuest.compose(
      tripleRequest({
        slots: [
          { position: "expr", start: starts[0] },
          { position: "expr", start: starts[0] + 1 },
        ],
      }),
    );
    expect(attemptOverlap.status).toBe("invalid");
    expect(attemptOverlap.candidates).toBeUndefined();
  });
  it("retains UTF-16 attempts and only the independent sibling as a candidate", () => {
    const result = router.compose(request());
    expect(result.tree).toBeUndefined();
    expect(result).toMatchObject({
      status: "partial",
      attempts: [{ owner: "tiny", range: { start: first + 1, end: close }, status: "partial" }],
      candidates: [
        { owner: "tiny", range: { start: second + 1, end: second + 3 }, subtree: { kind: "tiny" } },
      ],
    });
    expect(result.diagnostics).toEqual(result.attempts?.[0]?.diagnostics);
    expect(result.attempts).toHaveLength(1);
    expect(Object.isFrozen(result.candidates)).toBe(true);
  });
  it("returns only a tree for a fully valid document", () => {
    const result = router.compose(
      request({
        snapshot: { ...snapshot, text: "{ok}" },
        slots: [{ position: "expr", start: 0 }],
      }),
    );
    expect(result.status).toBe("valid");
    expect(result.tree).toBeDefined();
    expect(result.attempts).toBeUndefined();
    expect(result.candidates).toBeUndefined();
  });
  it("lets guest lexical rules shield a quoted close rather than scanning it as host text", () => {
    const lexical = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            if (input.start !== first + 1) return guest.parse(input);
            let quoted = false;
            let stop = input.start;
            for (; stop < input.snapshot.text.length; stop++) {
              input.meter.charge(1);
              const char = input.snapshot.text[stop];
              if (char === '"') quoted = !quoted;
              if (char === "}" && !quoted) break;
            }
            return {
              owner: "tiny",
              status: "partial",
              range: { start: input.start, end: stop },
              stop,
              reason: "safe-host-close",
              diagnostics: [],
            };
          },
        },
      ],
    );
    expect(text.indexOf("}", first)).toBeLessThan(close);
    expect(lexical.compose(request())).toMatchObject({
      status: "partial",
      attempts: [{ range: { end: close } }],
      candidates: [{ owner: "tiny" }],
    });
  });
  it("does not resume without host proof or from unsafe guest exits", () => {
    expect(router.compose(request({ hostContinuation: undefined })).candidates).toBeUndefined();
    for (const change of [
      { reason: "eof" },
      { status: "invalid" as const },
      { status: "unsupported" as const },
      { stop: close - 1 },
      { stop: first + 1 },
      { owner: "host" },
      { range: { start: first + 2, end: close } },
    ]) {
      const bad = createCompositionRouter(
        [profile],
        [
          {
            languageId: "tiny",
            parse(input) {
              return { ...guest.parse(input), ...(input.start === first + 1 ? change : {}) };
            },
          },
        ],
      );
      expect(bad.compose(request()).candidates).toBeUndefined();
    }
  });
  it("never reads the failed subtree and rejects unmetered host connectors", () => {
    const guarded = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            const result = guest.parse(input);
            if (input.start !== first + 1) return result;
            return Object.defineProperty({ ...result }, "subtree", {
              get() {
                throw new Error("failed subtree must stay opaque");
              },
            });
          },
        },
      ],
    );
    expect(guarded.compose(request()).candidates).toHaveLength(1);
    const unmetered = router.compose(
      request({
        hostContinuation: {
          validate({ close: marker, nextSlot }) {
            return { owner: "host", range: { start: marker.end, end: nextSlot.start } };
          },
        },
      }),
    );
    expect(unmetered.candidates).toEqual([]);
  });
  it("rejects unproven connectors and undeclared or overlapping slots", () => {
    for (const value of [
      true,
      { owner: "tiny", range: { start: close + 1, end: second } },
      { owner: "host", range: { start: close, end: second } },
      { owner: "host", range: { start: close + 1, end: second + 1 } },
    ]) {
      const result = router.compose(
        request({
          hostContinuation: {
            validate({ meter }) {
              meter.charge(second - close - 1);
              return value as never;
            },
          },
        }),
      );
      expect(result.candidates).toEqual([]);
      expect(result.tree).toBeUndefined();
    }
    for (const [index, slot] of [
      { position: "unknown", start: second },
      { position: "expr", start: close },
      { position: "expr", start: second - 1 },
    ].entries()) {
      expect(
        router.compose(request({ slots: [{ position: "expr", start: first }, slot] })).candidates,
      ).toEqual(index === 1 ? undefined : []);
    }
  });
  it("keeps an incomplete second attempt without a sibling candidate", () => {
    const incomplete = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            if (input.start === first + 1) return guest.parse(input);
            input.meter.charge(1);
            return {
              owner: "tiny",
              status: "partial",
              range: { start: input.start, end: input.start + 1 },
              stop: input.start + 1,
              reason: "eof",
              diagnostics: [],
              subtree: { forbidden: true },
            };
          },
        },
      ],
    );
    const result = incomplete.compose(request());
    expect(result.tree).toBeUndefined();
    expect(result).toMatchObject({
      status: "partial",
      attempts: [{ status: "partial" }, { status: "partial" }],
      candidates: [],
    });
  });
  it("fails closed on callback throws, stale/cancel, insufficient work/depth/diagnostics", () => {
    expect(
      router.compose(
        request({
          hostContinuation: {
            validate() {
              throw Error("host");
            },
          },
        }),
      ).status,
    ).toBe("invalid");
    let live = true;
    expect(
      router.compose(
        request({
          isCurrent: () => live,
          hostContinuation: {
            validate(input) {
              live = false;
              return request().hostContinuation?.validate(input) as never;
            },
          },
        }),
      ).status,
    ).toBe("stale");
    let cancelled = false;
    expect(
      router.compose(
        request({
          isCancelled: () => cancelled,
          hostContinuation: {
            validate(input) {
              cancelled = true;
              return request().hostContinuation?.validate(input) as never;
            },
          },
        }),
      ).status,
    ).toBe("cancelled");
    for (const limits of [
      { work: 10, depth: 4, diagnostics: 10 },
      { work: 100, depth: 1, diagnostics: 10 },
      { work: 100, depth: 4, diagnostics: 0 },
    ]) {
      expect(router.compose(request({ limits })).candidates).toBeUndefined();
    }
  });
});

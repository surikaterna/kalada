import { describe, expect, it } from "vitest";
import {
  COMPOSITION_CONTRACT_VERSION,
  type CompositionGuest,
  type CompositionProfile,
  type CompositionRequest,
  createCompositionRouter,
} from "./index.js";

const source = "🚀\r\nhost{abc} end";
const snapshot = { uri: "file:///test", text: source, version: 1, environmentGeneration: "env" };
const profile: CompositionProfile = {
  version: 1,
  hostLanguageId: "host",
  position: "expression",
  open: "{",
  close: "}",
  allowedGuests: ["tiny"],
  defaultGuest: "tiny",
};
const provider: CompositionGuest = {
  languageId: "tiny",
  parse({ snapshot, start, meter }) {
    expect(Object.isFrozen(snapshot)).toBe(true);
    meter.charge(1);
    return {
      owner: "tiny",
      status: "valid",
      range: { start, end: start + 3 },
      stop: start + 3,
      reason: "host-close",
      diagnostics: [],
      subtree: { kind: "tiny" },
    };
  },
};
const request = (overrides: Partial<CompositionRequest> = {}): CompositionRequest => ({
  snapshot,
  hostLanguageId: "host",
  slots: [{ position: "expression", start: 8 }],
  isCurrent: () => true,
  limits: { work: 100, depth: 4, diagnostics: 10 },
  ...overrides,
});
const router = createCompositionRouter([profile], [provider]);

describe("experimental composition contract", () => {
  it("retains original UTF-16 CRLF/astral ranges and opaque subtree", () => {
    expect(COMPOSITION_CONTRACT_VERSION).toBe(1);
    const result = router.compose(request());
    expect(result.status).toBe("valid");
    expect(
      result.tree?.children.map(({ owner, range }) => [owner, range.start, range.end]),
    ).toEqual([
      ["host", 0, 8],
      ["host", 8, 9],
      ["tiny", 9, 12],
      ["host", 12, 13],
      ["host", 13, 17],
    ]);
    expect(result.tree?.children[2]?.subtree).toEqual({ kind: "tiny" });
    expect(Object.isFrozen(result.tree?.children)).toBe(true);
  });
  it("rejects overlapping registration and slots, unknown selection, and missing close", () => {
    expect(() => createCompositionRouter([profile, profile], [provider])).toThrow();
    expect(() => createCompositionRouter([profile], [provider, provider])).toThrow();
    expect(
      router.compose(
        request({
          slots: [
            { position: "expression", start: 8 },
            { position: "expression", start: 8 },
          ],
        }),
      ).status,
    ).toBe("invalid");
    expect(
      router.compose(
        request({ slots: [{ position: "expression", start: 8, explicitGuest: "other" }] }),
      ).status,
    ).toBe("unsupported");
    expect(
      router.compose(request({ snapshot: { ...snapshot, text: source.replace("}", "]") } })).status,
    ).toBe("invalid");
  });
  it("checks wrong owner/stop, getter failures and missing subtree", () => {
    for (const change of [{ owner: "host" }, { stop: 13 }, { subtree: undefined }]) {
      const bad = createCompositionRouter(
        [profile],
        [
          {
            languageId: "tiny",
            parse(input) {
              return { ...provider.parse(input), ...change };
            },
          },
        ],
      );
      expect(bad.compose(request()).status).toBe("invalid");
    }
    const getter = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse() {
            return {
              get owner(): string {
                throw new Error("unsafe");
              },
            } as never;
          },
        },
      ],
    );
    expect(getter.compose(request()).status).toBe("invalid");
  });
  it("requires a complete host-close exit and measured guest interior work", () => {
    for (const change of [
      { reason: "eof" },
      {
        status: "valid" as const,
        diagnostics: [{ owner: "tiny", code: "ERROR", range: { start: 9, end: 12 } }],
      },
    ]) {
      const bad = createCompositionRouter(
        [profile],
        [
          {
            languageId: "tiny",
            parse(input) {
              return { ...provider.parse(input), ...change };
            },
          },
        ],
      );
      expect(bad.compose(request()).status).toBe("invalid");
    }
    const free = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse({ start }) {
            return {
              owner: "tiny",
              status: "valid",
              range: { start, end: start + 3 },
              stop: start + 3,
              reason: "host-close",
              diagnostics: [],
              subtree: {},
            };
          },
        },
      ],
    );
    expect(free.compose(request()).status).toBe("invalid");
  });
  it("enforces independent host maxStop without scanning guest interior", () => {
    const text = "{a}tail}";
    const late = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse({ start, meter }) {
            meter.charge(1);
            return {
              owner: "tiny",
              status: "valid",
              range: { start, end: 7 },
              stop: 7,
              reason: "host-close",
              diagnostics: [],
              subtree: {},
            };
          },
        },
      ],
    );
    const base = request({
      snapshot: { ...snapshot, text },
      slots: [{ position: "expression", start: 0 }],
    });
    // Without an independently known bound the trusted provider's lexical claim is authoritative.
    expect(late.compose(base).status).toBe("valid");
    expect(
      late.compose({ ...base, slots: [{ position: "expression", start: 0, maxStop: 2 }] }).status,
    ).toBe("invalid");
    for (const maxStop of [-1, 1, 8, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        late.compose({ ...base, slots: [{ position: "expression", start: 0, maxStop }] }).status,
      ).toBe("invalid");
    }
    expect(
      router.compose(request({ slots: [{ position: "expression", start: 8, maxStop: 12 }] })),
    ).toMatchObject({ status: "valid" });
  });
  it("accounts for host markers and guest work exactly once, including nested calls", () => {
    const tiny = request({
      snapshot: { ...snapshot, text: "{x}" },
      slots: [{ position: "expression", start: 0 }],
      limits: { work: 3, depth: 4, diagnostics: 10 },
    });
    const inner = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse({ start, meter }) {
            meter.charge(1);
            return {
              owner: "tiny",
              status: "valid",
              range: { start, end: start + 1 },
              stop: start + 1,
              reason: "host-close",
              diagnostics: [],
              subtree: {},
            };
          },
        },
      ],
    );
    expect(inner.compose(tiny).status).toBe("valid");
    expect(inner.compose({ ...tiny, limits: { ...tiny.limits, work: 2 } }).status).toBe("budget");
    const outer = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse({ start, meter }) {
            expect(inner.compose({ ...tiny, meter }).status).toBe("valid");
            return {
              owner: "tiny",
              status: "valid",
              range: { start, end: start + 1 },
              stop: start + 1,
              reason: "host-close",
              diagnostics: [],
              subtree: {},
            };
          },
        },
      ],
    );
    expect(outer.compose({ ...tiny, limits: { ...tiny.limits, work: 5 } }).status).toBe("valid");
    expect(outer.compose({ ...tiny, limits: { ...tiny.limits, work: 4 } }).status).toBe("budget");
  });
  it("rejects wrong-owner, wrong-code and out-of-guest diagnostics", () => {
    for (const diagnostic of [
      { owner: "host", code: "GUEST_ERROR", range: { start: 9, end: 10 } },
      { owner: "tiny", code: "wrong-code", range: { start: 9, end: 10 } },
      { owner: "tiny", code: "GUEST_ERROR", range: { start: 8, end: 10 } },
    ]) {
      const bad = createCompositionRouter(
        [profile],
        [
          {
            languageId: "tiny",
            parse(input) {
              return { ...provider.parse(input), status: "invalid", diagnostics: [diagnostic] };
            },
          },
        ],
      );
      expect(bad.compose(request()).status).toBe("invalid");
      expect(bad.compose(request()).reason).toBe("INVALID_GUEST_DIAGNOSTIC");
    }
  });
  it("returns copied guest-owned diagnostics without a tree on invalid or partial returns", () => {
    const bad = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            return {
              ...provider.parse(input),
              status: "partial",
              diagnostics: [{ owner: "tiny", code: "GUEST_ERROR", range: { start: 9, end: 12 } }],
            };
          },
        },
      ],
    );
    const result = bad.compose(request());
    expect(result.status).toBe("partial");
    expect(result.tree).toBeUndefined();
    expect(result.diagnostics[0]).toEqual({
      owner: "tiny",
      code: "GUEST_ERROR",
      range: { start: 9, end: 12 },
    });
    expect(bad.compose(request({ limits: { work: 100, depth: 4, diagnostics: 0 } })).status).toBe(
      "budget",
    );
  });
  it("fails closed on stale/cancelled and nested shared depth/work", () => {
    let current = true;
    const stale = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            current = false;
            return provider.parse(input);
          },
        },
      ],
    );
    expect(stale.compose(request({ isCurrent: () => current })).status).toBe("stale");
    expect(router.compose(request({ isCancelled: () => true })).status).toBe("cancelled");
    expect(router.compose(request({ limits: { work: 3, depth: 4, diagnostics: 10 } })).status).toBe(
      "budget",
    );
    const nested = createCompositionRouter(
      [profile],
      [
        {
          languageId: "tiny",
          parse(input) {
            expect(
              router.compose(
                request({ meter: input.meter, limits: { work: 100, depth: 1, diagnostics: 10 } }),
              ).status,
            ).toBe("budget");
            return provider.parse(input);
          },
        },
      ],
    );
    expect(
      nested.compose(request({ limits: { work: 100, depth: 2, diagnostics: 10 } })).status,
    ).toBe("budget");
  });
  it("requires a distinct reverse profile", () => {
    expect(router.compose(request({ hostLanguageId: "tiny" })).status).toBe("unsupported");
    const reverse = createCompositionRouter(
      [{ ...profile, hostLanguageId: "tiny", allowedGuests: ["host"], defaultGuest: "host" }],
      [
        {
          ...provider,
          languageId: "host",
          parse(input) {
            return { ...provider.parse(input), owner: "host" };
          },
        },
      ],
    );
    expect(reverse.compose(request({ hostLanguageId: "tiny" })).status).toBe("valid");
  });
});

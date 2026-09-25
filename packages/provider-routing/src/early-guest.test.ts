import { experimentalParseKaladaV1GuestExpressionPrefix } from "@kalada/syntax";
import { describe, expect, it } from "vitest";
import {
  type CompositionGuest,
  type CompositionRequest,
  createCompositionRouter,
} from "./index.js";

const profile = {
  version: 1 as const,
  hostLanguageId: "host",
  position: "expression",
  open: "{",
  close: "}",
  allowedGuests: ["kalada", "tiny"],
};
const kalada: CompositionGuest = {
  languageId: "kalada",
  parse({ snapshot, start, meter }) {
    const prefix = experimentalParseKaladaV1GuestExpressionPrefix(snapshot.text, start);
    meter.charge(Math.max(1, prefix.stop - start));
    const valid = prefix.ok && snapshot.text.startsWith("}", prefix.stop);
    return {
      owner: "kalada",
      status: valid ? "valid" : prefix.reason.startsWith("unsupported") ? "unsupported" : "invalid",
      range: prefix.range,
      stop: prefix.stop,
      reason: valid ? "host-close" : prefix.reason,
      diagnostics: prefix.diagnostics.map(({ code, range }) => ({ owner: "kalada", code, range })),
      ...(valid ? { subtree: prefix.parsed } : {}),
    };
  },
};
const tiny: CompositionGuest = {
  languageId: "tiny",
  parse({ start, meter }) {
    meter.charge(1);
    return {
      owner: "tiny",
      status: "invalid",
      stop: start,
      range: { start, end: start },
      reason: "tiny-error",
      diagnostics: [],
    };
  },
};
const compose = createCompositionRouter([profile], [kalada, tiny]);
const request = (
  text: string,
  overrides: Partial<CompositionRequest> = {},
): CompositionRequest => ({
  snapshot: { uri: "file:///guest", text, version: 1, environmentGeneration: "env" },
  hostLanguageId: "host",
  slots: [{ position: "expression", start: text.indexOf("{"), explicitGuest: "kalada" }],
  limits: { work: 1000, depth: 4, diagnostics: 20 },
  isCurrent: () => true,
  ...overrides,
});

describe("bounded early guest failures", () => {
  it.each(["//", "/*", "'", "`", "{", "a //", "a /*", "a '", "a `", "(a}"])(
    "keeps original offsets at %s without authorizing a sibling",
    (prefix) => {
      const text = `🚀\r\n{${prefix}}later}SIBLING`;
      const start = text.indexOf("{") + 1;
      const parsed = experimentalParseKaladaV1GuestExpressionPrefix(text, start);
      const result = compose.compose(request(text));
      expect(result.status).not.toBe("valid");
      expect(result.reason).toBe(parsed.reason);
      expect(result.tree).toBeUndefined();
      expect(result.diagnostics).toEqual(
        parsed.diagnostics.map(({ code, range }) => ({ owner: "kalada", code, range })),
      );
      expect(parsed.stop).toBeGreaterThanOrEqual(start);
    },
  );
  it("retains EOF failures and validates success only with a real close", () => {
    expect(compose.compose(request("{a + 1")).tree).toBeUndefined();
    expect(compose.compose(request("{a + 1")).reason).toBe("eof");
    expect(compose.compose(request("{a + 1}TAIL")).status).toBe("valid");
    expect(compose.compose(request("{a + 1]TAIL")).status).not.toBe("valid");
    const tinyRequest = request("{!}TAIL", {
      slots: [{ position: "expression", start: 0, explicitGuest: "tiny", maxStop: 1 }],
    });
    expect(compose.compose(tinyRequest)).toMatchObject({ status: "invalid", reason: "tiny-error" });
  });
  it("does not charge a close marker for early failure and honors diagnostic limits", () => {
    const text = "{'oops}LATER";
    const base = request(text, { limits: { work: 2, depth: 4, diagnostics: 20 } });
    expect(compose.compose(base).status).toBe("unsupported");
    expect(compose.compose({ ...base, limits: { ...base.limits, work: 1 } })).toMatchObject({
      status: "budget",
      diagnostics: [],
    });
    expect(compose.compose({ ...base, limits: { ...base.limits, diagnostics: 0 } })).toMatchObject({
      status: "budget",
      diagnostics: [],
    });
  });
  it("rejects forged early exits and diagnostics without leaking them", () => {
    const text = "{'oops}LATER";
    const base = kalada.parse({
      snapshot: request(text).snapshot,
      start: 1,
      close: "}",
      meter: { charge: () => true } as never,
    });
    for (const change of [
      { owner: "host" },
      { status: "surprise" },
      { stop: -1 },
      { stop: text.length + 1 },
      { range: { start: 0, end: 1 } },
      { range: { start: 1, end: 2 } },
      { reason: "" },
      { diagnostics: [{ owner: "host", code: "BAD", range: { start: 1, end: 1 } }] },
      { diagnostics: [{ owner: "kalada", code: "BAD", range: { start: 0, end: 1 } }] },
      { diagnostics: [{ owner: "kalada", code: "BAD", range: { start: 2, end: 2 } }] },
    ]) {
      const forged = createCompositionRouter(
        [profile],
        [{ languageId: "kalada", parse: () => ({ ...base, ...change }) as never }],
      );
      const result = forged.compose(request(text));
      expect(result.status).toBe("invalid");
      expect(result.diagnostics).toEqual([]);
    }
    const bounded = (maxStop: number) =>
      compose.compose(
        request(text, {
          slots: [{ position: "expression", start: 0, explicitGuest: "kalada", maxStop }],
        }),
      );
    expect(bounded(0)).toMatchObject({ status: "invalid", reason: "INVALID_MAX_STOP" });
    expect(bounded(1)).toMatchObject({ status: "unsupported" });
  });
  it("keeps zero-width diagnostics at the stop and rejects stale or cancelled callbacks", () => {
    const failure: CompositionGuest = {
      languageId: "kalada",
      parse({ start }) {
        return {
          owner: "kalada",
          status: "partial",
          stop: start,
          range: { start, end: start },
          reason: "incomplete",
          diagnostics: [{ owner: "kalada", code: "INCOMPLETE", range: { start, end: start } }],
          subtree: { ignored: true },
        };
      },
    };
    const early = createCompositionRouter([profile], [failure]);
    const earlyResult = early.compose(request("{no close"));
    expect(earlyResult).toMatchObject({
      status: "partial",
      reason: "incomplete",
      diagnostics: [{ range: { start: 1, end: 1 } }],
    });
    expect(earlyResult.tree).toBeUndefined();
    let current = true;
    const changing = createCompositionRouter(
      [profile],
      [
        {
          ...failure,
          parse(input) {
            current = false;
            return failure.parse(input);
          },
        },
      ],
    );
    expect(changing.compose(request("{x", { isCurrent: () => current }))).toMatchObject({
      status: "stale",
      diagnostics: [],
    });
    expect(early.compose(request("{x", { isCancelled: () => true }))).toMatchObject({
      status: "cancelled",
      diagnostics: [],
    });
  });
  it.each(["unsupported", "partial"] as const)(
    "does not inspect a %s guest subtree on an early exit",
    (status) => {
      let subtreeReads = 0;
      const guest: CompositionGuest = {
        languageId: "tiny",
        parse({ start, meter }) {
          meter.charge(1);
          return {
            owner: "tiny",
            status,
            stop: start,
            range: { start, end: start },
            reason: "unsupported-quote",
            diagnostics: [{ owner: "tiny", code: "QUOTE", range: { start, end: start } }],
            get subtree(): never {
              subtreeReads++;
              throw new Error("nonvalid subtree must not be inspected");
            },
          };
        },
      };
      const result = createCompositionRouter([profile], [guest]).compose(
        request("{'oops}LATER", {
          slots: [{ position: "expression", start: 0, explicitGuest: "tiny", maxStop: 1 }],
          limits: { work: 2, depth: 4, diagnostics: 1 },
        }),
      );
      expect(result).toMatchObject({
        status,
        reason: "unsupported-quote",
        diagnostics: [{ owner: "tiny", code: "QUOTE", range: { start: 1, end: 1 } }],
      });
      expect(result.tree).toBeUndefined();
      expect(subtreeReads).toBe(0);
    },
  );
  it("fails closed when a valid guest subtree getter throws", () => {
    const guest: CompositionGuest = {
      languageId: "tiny",
      parse({ start, meter }) {
        meter.charge(1);
        return {
          owner: "tiny",
          status: "valid",
          stop: start + 1,
          range: { start, end: start + 1 },
          reason: "host-close",
          diagnostics: [],
          get subtree(): never {
            throw new Error("unsafe subtree");
          },
        };
      },
    };
    const result = createCompositionRouter([profile], [guest]).compose(
      request("{x}", { slots: [{ position: "expression", start: 0, explicitGuest: "tiny" }] }),
    );
    expect(result).toMatchObject({
      status: "invalid",
      reason: "COMPOSITION_FAILURE",
      diagnostics: [],
    });
    expect(result.tree).toBeUndefined();
  });
});

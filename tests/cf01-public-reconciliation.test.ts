import {
  type CompositionGuest,
  type CompositionOutcome,
  type CompositionRequest,
  createCompositionRouter,
} from "@kalada/provider-routing";
import {
  experimentalParseKaladaV1GuestExpressionPrefix,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";
import { describe, expect, it } from "vitest";
import { integratedTinyRecovery } from "./fixtures/integrated-tiny-recovery.js";

const profile = {
  version: 1 as const,
  hostLanguageId: "neutral-host",
  position: "expression",
  allowedGuests: ["kalada", "tiny"],
  open: "{",
  close: "}",
};
const authentic = new WeakSet<object>();

const kalada: CompositionGuest = {
  languageId: "kalada",
  parse({ snapshot, start, meter }) {
    const parsed = experimentalParseKaladaV1GuestExpressionPrefix(snapshot.text, start);
    meter.charge(Math.max(1, parsed.stop - start));
    const safeClose = parsed.reason === "outer-brace" && snapshot.text[parsed.stop] === "}";
    const unsupported =
      parsed.reason.startsWith("unsupported") ||
      parsed.diagnostics.some((item) => item.code === "KALADA_SYNTAX_UNSUPPORTED_FORM");
    const status = parsed.ok && safeClose ? "valid" : unsupported ? "unsupported" : "partial";
    if (status === "valid" && parsed.parsed) authentic.add(parsed.parsed);
    return {
      owner: "kalada",
      status,
      range: parsed.range,
      stop: parsed.stop,
      reason:
        status === "valid"
          ? "host-close"
          : unsupported
            ? "unsupported-lexical"
            : safeClose
              ? "safe-host-close"
              : parsed.reason,
      diagnostics: parsed.diagnostics.map(({ code, range }) => ({ owner: "kalada", code, range })),
      ...(status === "valid" ? { subtree: parsed.parsed } : {}),
    };
  },
};

// Independent decimal-addition guest: no syntax import or kernel evaluation.
const tiny: CompositionGuest = {
  languageId: "tiny",
  parse({ snapshot, start, meter }) {
    const source = snapshot.text;
    const token = /^[0-9+ \t]*/u.exec(source.slice(start))?.[0] ?? "";
    const stop = start + token.length;
    meter.charge(Math.max(1, token.length));
    const safe = source[stop] === "}";
    const complete = /^[ \t]*[0-9]+(?:[ \t]*\+[ \t]*[0-9]+)*[ \t]*$/u.test(token);
    const valid = safe && complete;
    const reason = tinyReason(valid, safe, stop === source.length);
    return {
      owner: "tiny",
      status:
        reason === "host-close"
          ? "valid"
          : reason === "unsupported-token"
            ? "unsupported"
            : "partial",
      range: { start, end: stop },
      stop,
      reason,
      diagnostics: valid
        ? []
        : [{ owner: "tiny", code: "TINY_EXPECTED_DECIMAL", range: { start: stop, end: stop } }],
      ...(valid ? { subtree: { decimal: token } } : {}),
    };
  },
};

function tinyReason(valid: boolean, safe: boolean, eof: boolean) {
  if (valid) return "host-close";
  if (safe) return "safe-host-close";
  return eof ? "eof" : "unsupported-token";
}

const router = createCompositionRouter([profile], [kalada, tiny]);
function request(text: string, guest: "kalada" | "tiny" = "kalada"): CompositionRequest {
  const first = text.indexOf("{", text.indexOf("host"));
  const next = text.indexOf("next", first);
  const second = next < 0 ? -1 : text.indexOf("{", next);
  return {
    snapshot: { uri: "file:///cf01", text, version: 1, environmentGeneration: "env-1" },
    hostLanguageId: "neutral-host",
    slots: [first, second]
      .filter((at) => at >= 0)
      .map((start) => ({ position: "expression", start, explicitGuest: guest })),
    limits: { work: 1000, depth: 4, diagnostics: 10 },
    isCurrent: () => true,
    hostContinuation: {
      validate({ snapshot, close, nextSlot, meter }) {
        const from = close.end;
        const to = nextSlot.start;
        if (snapshot.text.slice(from, to) !== "next" || !meter.charge(to - from))
          throw Error("invalid host connector");
        return { owner: "neutral-host", range: { start: from, end: to } };
      },
    },
  };
}

function run(text: string, guest: "kalada" | "tiny" = "kalada") {
  return router.compose(request(text, guest));
}

// Deliberately local sink: candidates are never whole-document authority.
function admission(outcome: CompositionOutcome) {
  const actions = { lower: 0, emit: 0, edit: 0 };
  if (outcome.status !== "valid" || !outcome.tree) return actions;
  const children = outcome.tree.children.filter((node) => node.owner === "kalada");
  if (children.length !== 1) return actions;
  const parsed = children[0].subtree;
  if (!parsed || typeof parsed !== "object" || !authentic.has(parsed)) return actions;
  actions.lower++;
  const lowered = lowerKaladaV1Expression(parsed as ReturnType<typeof parseKaladaV1Expression>);
  if (lowered.ok) {
    actions.emit++;
    actions.edit++;
  }
  return actions;
}

function checkStaleAndForgedExits(base: CompositionRequest) {
  let live = true;
  const changing = createCompositionRouter(
    [profile],
    [
      {
        ...kalada,
        parse(input) {
          const result = kalada.parse(input);
          live = false;
          return result;
        },
      },
    ],
  );
  expect(changing.compose({ ...base, isCurrent: () => live }).status).toBe("stale");
  for (const change of [
    { owner: "host" },
    { stop: 0 },
    { range: { start: 0, end: 1 } },
    { reason: "forged" },
  ]) {
    const forged = createCompositionRouter(
      [profile],
      [
        {
          ...kalada,
          parse(input) {
            return { ...kalada.parse(input), ...change };
          },
        },
      ],
    );
    expect(admission(forged.compose(base))).toEqual({ lower: 0, emit: 0, edit: 0 });
  }
}

function checkDeserializedExit(base: CompositionRequest) {
  const parsed = parseKaladaV1Expression("1");
  expect(lowerKaladaV1Expression(JSON.parse(JSON.stringify(parsed)))).toMatchObject({ ok: false });
  const deserialized = createCompositionRouter(
    [profile],
    [
      {
        ...kalada,
        parse(input) {
          const value = kalada.parse(input);
          return { ...value, subtree: JSON.parse(JSON.stringify(value.subtree)) };
        },
      },
    ],
  );
  expect(admission(deserialized.compose(base))).toEqual({ lower: 0, emit: 0, edit: 0 });
}

function delegatedTinyWithStops(text: string) {
  const starts: number[] = [];
  const measuring = createCompositionRouter(
    [profile],
    [
      {
        ...tiny,
        parse(input) {
          starts.push(input.start);
          return tiny.parse(input);
        },
      },
    ],
  );
  return { outcome: measuring.compose(request(text, "tiny")), starts };
}

function checkComparableTinyVector(
  integrated: ReturnType<typeof integratedTinyRecovery>,
  delegated: CompositionOutcome,
) {
  expect(delegated.status).toBe(integrated.status);
  const guestRanges =
    delegated.status === "valid"
      ? delegated.tree?.children.filter((node) => node.owner === "tiny").map((node) => node.range)
      : delegated.candidates?.map((node) => node.range);
  if (integrated.attempts[0]?.diagnostics.length || delegated.status === "valid") {
    expect(guestRanges).toEqual(
      integrated.ranges
        .filter((range) => range.owner === "tiny")
        .map(({ start, end }) => ({ start, end })),
    );
  } else {
    expect(delegated.tree).toBeUndefined(); // valid earlier slot is not whole-tree authority
  }
  expect(delegated.diagnostics.map(({ code, range }) => ({ code, range }))).toEqual(
    integrated.attempts.flatMap((attempt) => attempt.diagnostics),
  );
  if (delegated.attempts?.[0]) {
    expect(delegated.attempts[0].range.end).toBe(integrated.attempts[0].stop);
  }
}

describe("#146 public parser composition reconciliation", () => {
  it("preserves original UTF-16 ownership and real standalone Kalada lowering", () => {
    const text = '🚀\r\nhost{"}" + (1 + 2)}TAIL';
    const outcome = run(text);
    const start = text.indexOf("{") + 1;
    const stop = text.indexOf("}TAIL");
    expect(outcome.status).toBe("valid");
    expect(outcome.tree?.children.map(({ owner, range }) => ({ owner, range }))).toEqual([
      { owner: "neutral-host", range: { start: 0, end: start - 1 } },
      { owner: "neutral-host", range: { start: start - 1, end: start } },
      { owner: "kalada", range: { start, end: stop } },
      { owner: "neutral-host", range: { start: stop, end: stop + 1 } },
      { owner: "neutral-host", range: { start: stop + 1, end: text.length } },
    ]);
    const standalone = parseKaladaV1Expression(text.slice(start, stop));
    expect(standalone.diagnostics).toEqual([]);
    expect(lowerKaladaV1Expression(standalone).ok).toBe(
      lowerKaladaV1Expression(
        outcome.tree?.children[2].subtree as ReturnType<typeof parseKaladaV1Expression>,
      ).ok,
    );
    expect(admission(run("host{1 + (2 * 3)}TAIL"))).toEqual({ lower: 1, emit: 1, edit: 1 });
  });

  it("recovers only a lexically safe malformed first slot, retaining diagnostics and a non-authoritative sibling", () => {
    const text = "🚀\r\nhost{1 + }next{2}TAIL";
    const outcome = run(text);
    const first = text.indexOf("{") + 1;
    const second = text.indexOf("{", first) + 1;
    expect(outcome).toMatchObject({
      status: "partial",
      attempts: [
        {
          owner: "kalada",
          status: "partial",
          reason: "safe-host-close",
          range: { start: first, end: text.indexOf("}next") },
        },
      ],
      candidates: [{ owner: "kalada", range: { start: second, end: second + 1 } }],
    });
    expect(outcome.tree).toBeUndefined();
    expect(outcome.diagnostics).toEqual(outcome.attempts?.[0].diagnostics);
    expect(outcome.diagnostics).toContainEqual({
      owner: "kalada",
      code: "KALADA_SYNTAX_EXPECTED_EXPRESSION",
      range: { start: 13, end: 13 },
    });
    expect(admission(outcome)).toEqual({ lower: 0, emit: 0, edit: 0 });
  });

  it.each(["// x", "/* x", "{1", "'x'", '"unterminated', "1 + "])(
    "never invents safe recovery from unsupported or incomplete lexical input %s",
    (expression) => {
      const outcome = run(`host{${expression}}next{2}TAIL`);
      if (expression === "1 + ") {
        expect(outcome.status).toBe("partial");
        expect(outcome.candidates).toHaveLength(1);
      } else {
        expect(outcome.tree).toBeUndefined();
        expect(outcome.candidates).toBeUndefined();
      }
      expect(admission(outcome)).toEqual({ lower: 0, emit: 0, edit: 0 });
    },
  );

  it("rejects stale/cancelled/budget and forged exits without admitting actions", () => {
    const base = request("host{1}TAIL");
    for (const overrides of [
      { isCurrent: () => false },
      { isCancelled: () => true },
      { limits: { work: 2, depth: 4, diagnostics: 10 } },
      { limits: { work: 1000, depth: 1, diagnostics: 10 } },
    ]) {
      const result = router.compose({ ...base, ...overrides });
      expect(result.status).not.toBe("valid");
      expect(admission(result)).toEqual({ lower: 0, emit: 0, edit: 0 });
    }
    checkStaleAndForgedExits(base);
    checkDeserializedExit(base);
  });

  it("rejects undeclared, ambiguous, non-progress and out-of-range handoffs", () => {
    const base = request("host{1}TAIL");
    expect(router.compose({ ...base, slots: [{ position: "unknown", start: 4 }] }).status).toBe(
      "unsupported",
    );
    expect(router.compose({ ...base, slots: [{ position: "expression", start: 4 }] }).status).toBe(
      "unsupported",
    );
    expect(
      router.compose({
        ...base,
        slots: [{ position: "expression", start: 4, explicitGuest: "absent" }],
      }).status,
    ).toBe("unsupported");
    expect(() => createCompositionRouter([profile, profile], [kalada])).toThrow();
    for (const change of [
      { stop: 5, range: { start: 5, end: 5 } },
      { stop: 99, range: { start: 5, end: 99 } },
      { diagnostics: [{ owner: "host", code: "FORGED", range: { start: 5, end: 6 } }] },
    ]) {
      const result = createCompositionRouter(
        [profile],
        [
          {
            ...kalada,
            parse(input) {
              return { ...kalada.parse(input), ...change };
            },
          },
        ],
      ).compose(base);
      expect(result.status).toBe("invalid");
      expect(admission(result)).toEqual({ lower: 0, emit: 0, edit: 0 });
    }
  });

  it("compares seven integrated vs delegated independent tiny vectors", () => {
    const vectors = [
      "host{1}next{2}TAIL",
      "host{1 + }next{2}TAIL",
      "🚀\r\nhost{1 + }next{2}TAIL",
      "host{1}next{2 + 3}TAIL",
      "host{1}next{2 + }TAIL",
      "host{1}next{2",
      "host{!}next{2}TAIL",
    ];
    const observations = vectors.map((text) => ({
      integrated: integratedTinyRecovery(text),
      delegated: run(text, "tiny"),
    }));
    expect(
      observations.map(({ integrated }) => integrated.attempts.map(({ stop }) => stop)),
    ).toEqual([[6, 13], [9, 16], [13, 20], [6, 17], [6, 16], [6, 13], [5]]);
    for (const { integrated, delegated } of observations.slice(0, 5))
      checkComparableTinyVector(integrated, delegated);
    expect(
      observations.map(({ integrated, delegated }) => [integrated.status, delegated.status]),
    ).toEqual([
      ["valid", "valid"],
      ["partial", "partial"],
      ["partial", "partial"],
      ["valid", "valid"],
      ["partial", "partial"],
      ["partial", "partial"],
      ["unsupported", "unsupported"],
    ]);
    expect(observations[5].delegated.tree).toBeUndefined();
    const eof = delegatedTinyWithStops(vectors[5]);
    expect(eof.starts).toEqual([5, 12]);
    expect(eof.outcome).toMatchObject({ status: "partial", reason: "eof" });
    expect(eof.outcome.attempts).toBeUndefined();
    expect(eof.outcome.diagnostics.map(({ range }) => range)).toEqual([{ start: 13, end: 13 }]);
    expect(observations[6].delegated.candidates).toBeUndefined();
    const unsupported = delegatedTinyWithStops(vectors[6]);
    expect(unsupported.starts).toEqual([5]);
    expect(unsupported.outcome.attempts).toBeUndefined();
    expect(unsupported.outcome.diagnostics.map(({ range }) => range)).toEqual([
      { start: 5, end: 5 },
    ]);
    expect(eof.outcome.diagnostics).toEqual(observations[5].delegated.diagnostics);
    expect(observations[6].delegated.reason).toBe("unsupported-token");
  });
});

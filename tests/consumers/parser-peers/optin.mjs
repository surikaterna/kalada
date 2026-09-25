import assert from "node:assert/strict";
import { experimentalParseKaladaV1GuestExpressionPrefix } from "@kalada/syntax";
import { kaladaGuest, limits, profile, request, router, tiny } from "./peers.mjs";

const host = router([tiny, kaladaGuest(experimentalParseKaladaV1GuestExpressionPrefix)]);
const kalada = (text, start = 0, overrides = {}) =>
  host.compose(request(text, start, "kalada", overrides));
for (const text of [
  '🚀\r\nhost{"}" + 1}TAIL',
  "🚀{a ? (b + 1) : c}TAIL",
  '{a?.field ?? "x"}TAIL',
]) {
  const start = text.indexOf("{");
  const outcome = kalada(text, start);
  assert.equal(outcome.status, "valid", text);
  assert.equal(outcome.tree.range.end, text.length);
  const guest = outcome.tree.children.find(({ owner }) => owner === "kalada");
  assert.equal(guest.range.start, start + 1);
  assert.equal(guest.subtree.document.source, text);
  assert.equal(text[guest.range.end], "}");
  assert.equal(outcome.tree.children.at(-1).range.end, text.length);
}
assert.equal(host.compose(request("{12+3}TAIL", 0, "tiny")).status, "valid");
for (const text of [
  "{}TAIL",
  "{a b}TAIL",
  "{(a}TAIL",
  "{{a}TAIL",
  '{"unterminated}TAIL',
  "{a + 1",
]) {
  const outcome = kalada(text);
  assert.equal(outcome.status, "invalid", text);
  assert.equal(outcome.tree, undefined);
}
for (const [opener, reason] of [
  ["//", "unsupported-comment"],
  ["/*", "unsupported-comment"],
  ["'", "unsupported-quote"],
  ["`", "unsupported-quote"],
]) {
  const text = `🚀\r\nhost{a + ${opener}bad}TAIL{1}`;
  const start = text.indexOf("{");
  const stop = text.indexOf(opener);
  const outcome = kalada(text, start);
  assert.equal(outcome.status, "unsupported", text);
  assert.equal(outcome.reason, reason, text);
  assert.deepEqual(outcome.diagnostics, [
    { owner: "kalada", code: "KALADA_SYNTAX_UNSUPPORTED_FORM", range: { start: stop, end: stop } },
    {
      owner: "kalada",
      code: "KALADA_SYNTAX_EXPECTED_EXPRESSION",
      range: { start: stop, end: stop },
    },
  ]);
  assert.equal(outcome.tree, undefined);
  assert.equal(text[stop], opener[0]);
  assert.equal(text.slice(stop).includes("TAIL{1}"), true);
}
assert.equal(kalada("{a + }TAIL").diagnostics[0].owner, "kalada");
assert.equal(kalada("{a + }TAIL", 0, { limits: { ...limits, diagnostics: 0 } }).status, "budget");
assert.equal(
  kalada("{ab}TAIL", 0, {
    slots: [{ position: "expression", start: 0, explicitGuest: "kalada", maxStop: 2 }],
  }).status,
  "invalid",
);
assert.equal(kalada("{a}TAIL", 0, { isCancelled: () => true }).status, "cancelled");
assert.equal(
  kalada("{a}TAIL", 0, {
    isCurrent: ({ environmentGeneration }) => environmentGeneration === "other",
  }).status,
  "stale",
);
assert.equal(kalada("{a}TAIL", 0, { limits: { ...limits, work: 2 } }).status, "budget");
assert.equal(kalada("{a}TAIL", 0, { limits: { ...limits, work: 7 } }).status, "valid");
for (const change of [
  { owner: "forged" },
  { stop: 1, range: { start: 1, end: 1 } },
  { stop: 5 },
  { stop: Number.MAX_SAFE_INTEGER },
  { range: { start: 0, end: 2 } },
  { subtree: undefined },
]) {
  const forged = router(
    [
      {
        languageId: "kalada",
        parse(input) {
          return {
            ...kaladaGuest(experimentalParseKaladaV1GuestExpressionPrefix).parse(input),
            ...change,
          };
        },
      },
    ],
    [profile(["kalada"], "kalada")],
  );
  assert.equal(forged.compose(request("{a}TAIL", 0)).status, "invalid");
}
const malformed = router(
  [
    {
      languageId: "kalada",
      parse() {
        throw Error("broken callback");
      },
    },
  ],
  [profile(["kalada"], "kalada")],
);
assert.equal(malformed.compose(request("{a}TAIL", 0)).tree, undefined);
let generation = "env";
const changing = router(
  [
    {
      languageId: "kalada",
      parse(input) {
        generation = "next";
        return kaladaGuest(experimentalParseKaladaV1GuestExpressionPrefix).parse(input);
      },
    },
  ],
  [profile(["kalada"], "kalada")],
);
const stale = changing.compose(
  request("{a}TAIL", 0, undefined, {
    isCurrent: (snapshot) => snapshot.environmentGeneration === generation,
  }),
);
assert.equal(stale.status, "stale");
assert.equal(stale.tree, undefined);
console.log("opt-in syntax and tiny peers passed");

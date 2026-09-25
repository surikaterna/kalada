import assert from "node:assert/strict";
import { limits, profile, request, router, tiny } from "./peers.mjs";

const host = router([tiny], [profile(["tiny"], "tiny")]);
const text = "🚀\r\nhost{12+34} END";
const composed = host.compose(request(text, 8));
assert.equal(composed.status, "valid");
assert.deepEqual(
  composed.tree.children.map(({ owner, range }) => [owner, range.start, range.end]),
  [
    ["host", 0, 8],
    ["host", 8, 9],
    ["tiny", 9, 14],
    ["host", 14, 15],
    ["host", 15, 19],
  ],
);
assert.deepEqual(composed.tree.children[2].subtree, { kind: "decimal-plus", digits: 4 });
assert.equal(host.compose(request("{12+}", 0)).tree, undefined);
assert.equal(
  host.compose(request("{12+3}", 0, undefined, { limits: { ...limits, work: 5 } })).status,
  "budget",
);
assert.equal(
  host.compose(request("{12+3}", 0, undefined, { limits: { ...limits, work: 6 } })).status,
  "valid",
);
assert.equal(
  host.compose(request("{1}", 0, undefined, { limits: { ...limits, depth: 1 } })).status,
  "budget",
);
assert.equal(
  host.compose(request("{1}", 0, undefined, { isCancelled: () => true })).status,
  "cancelled",
);
assert.equal(
  host.compose(request("{1}", 0, undefined, { isCurrent: () => false })).status,
  "stale",
);
assert.equal(host.compose(request("{1}", 0, "kalada")).status, "unsupported");
assert.equal(router([tiny]).compose(request("{1}", 0)).status, "unsupported");
assert.equal(
  host.compose(request("{1}", 0, undefined, { hostLanguageId: "tiny" })).status,
  "unsupported",
);
const reverse = router(
  [
    {
      ...tiny,
      languageId: "host",
      parse(input) {
        return { ...tiny.parse(input), owner: "host" };
      },
    },
  ],
  [{ ...profile(["host"], "host"), hostLanguageId: "tiny" }],
);
assert.equal(
  reverse.compose(request("{1}", 0, undefined, { hostLanguageId: "tiny" })).status,
  "valid",
);
const nested = router(
  [
    {
      languageId: "tiny",
      parse(input) {
        const inner = host.compose(request("{1}", 0, undefined, { meter: input.meter }));
        if (inner.status !== "valid") return { ...tiny.parse(input), status: "invalid" };
        return tiny.parse(input);
      },
    },
  ],
  [profile(["tiny"], "tiny")],
);
assert.equal(
  nested.compose(request("{1}", 0, undefined, { limits: { ...limits, work: 6 } })).status,
  "valid",
);
assert.equal(
  nested.compose(request("{1}", 0, undefined, { limits: { ...limits, work: 5 } })).status,
  "budget",
);
assert.equal(
  nested.compose(request("{1}", 0, undefined, { limits: { ...limits, depth: 3 } })).status,
  "budget",
);
console.log("domain-only tiny peer passed");

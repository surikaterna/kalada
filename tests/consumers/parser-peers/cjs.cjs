const { createCompositionRouter } = require("@kalada/provider-routing");
const { experimentalParseKaladaV1GuestExpressionPrefix: parse } = require("@kalada/syntax");
const guest = {
  languageId: "kalada",
  parse({ snapshot, start, meter }) {
    const result = parse(snapshot.text, start);
    meter.charge(result.stop - start);
    return {
      owner: "kalada",
      status: result.ok ? "valid" : "invalid",
      stop: result.stop,
      range: result.range,
      reason: result.ok ? "host-close" : result.reason,
      diagnostics: [],
      subtree: result.parsed,
    };
  },
};
const profile = {
  version: 1,
  hostLanguageId: "host",
  position: "expr",
  open: "{",
  close: "}",
  allowedGuests: ["kalada"],
};
const outcome = createCompositionRouter([profile], [guest]).compose({
  snapshot: { uri: "file:///cjs", text: "{1 + 2}TAIL", version: 1, environmentGeneration: "env" },
  hostLanguageId: "host",
  slots: [{ position: "expr", start: 0, explicitGuest: "kalada" }],
  isCurrent: () => true,
  limits: { work: 100, depth: 3, diagnostics: 2 },
});
if (outcome.status !== "valid" || outcome.tree.children[1].range.end !== 6)
  throw Error("CJS composition failed");

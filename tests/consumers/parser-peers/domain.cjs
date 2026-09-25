const { createCompositionRouter } = require("@kalada/provider-routing");
const profile = {
  version: 1,
  hostLanguageId: "host",
  position: "expr",
  allowedGuests: ["tiny"],
  open: "{",
  close: "}",
};
const guest = {
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
      subtree: { kind: "decimal" },
    };
  },
};
const result = createCompositionRouter([profile], [guest]).compose({
  snapshot: { uri: "file:///domain", text: "{1}tail", version: 1, environmentGeneration: "env" },
  hostLanguageId: "host",
  slots: [{ position: "expr", start: 0, explicitGuest: "tiny" }],
  isCurrent: () => true,
  limits: { work: 7, depth: 2, diagnostics: 0 },
});
if (result.status !== "valid") throw Error("Neutral CJS composition failed");

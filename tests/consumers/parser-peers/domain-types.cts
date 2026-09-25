import routing = require("@kalada/provider-routing");
const profile: routing.CompositionProfile = {
  version: 1,
  hostLanguageId: "host",
  position: "expr",
  allowedGuests: ["tiny"],
  open: "{",
  close: "}",
};
const guest: routing.CompositionGuest = {
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
      subtree: {},
    };
  },
};
void routing.createCompositionRouter([profile], [guest]);

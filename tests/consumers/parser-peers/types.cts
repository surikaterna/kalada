import routing = require("@kalada/provider-routing");
import syntax = require("@kalada/syntax");
const profile: routing.CompositionProfile = {
  version: 1,
  hostLanguageId: "host",
  position: "expr",
  open: "{",
  close: "}",
  allowedGuests: ["kalada"],
};
const guest: routing.CompositionGuest = {
  languageId: "kalada",
  parse({ snapshot, start, meter }) {
    const prefix = syntax.experimentalParseKaladaV1GuestExpressionPrefix(snapshot.text, start);
    meter.charge(prefix.stop - start);
    return {
      owner: "kalada",
      status: prefix.ok ? "valid" : "invalid",
      reason: prefix.ok ? "host-close" : prefix.reason,
      stop: prefix.stop,
      range: prefix.range,
      diagnostics: [],
      subtree: prefix.parsed,
    };
  },
};
void routing.createCompositionRouter([profile], [guest]);

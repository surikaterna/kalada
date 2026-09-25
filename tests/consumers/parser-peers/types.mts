import {
  type CompositionGuest,
  type CompositionProfile,
  createCompositionRouter,
} from "@kalada/provider-routing";
import { experimentalParseKaladaV1GuestExpressionPrefix } from "@kalada/syntax";

const profile: CompositionProfile = {
  version: 1,
  hostLanguageId: "host",
  position: "expr",
  open: "{",
  close: "}",
  allowedGuests: ["kalada"],
};
const guest: CompositionGuest = {
  languageId: "kalada",
  parse({ snapshot, start, meter }) {
    const prefix = experimentalParseKaladaV1GuestExpressionPrefix(snapshot.text, start);
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
void createCompositionRouter([profile], [guest]);

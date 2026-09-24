import { compose } from "./host-profile.js";
import { tinyGuest } from "./tiny-guest.js";

export function runTiny(source: string) {
  const snapshot = { source, version: 1, environment: "tiny" };
  return compose({
    snapshot,
    current: snapshot,
    profiles: [{ version: 1, position: "expression", allowed: ["tiny"], rootDefault: "tiny" }],
    guests: { tiny: tinyGuest },
    budget: { work: 256, depth: 2, diagnostics: 2 },
  });
}

import { createCompositionRouter } from "@kalada/provider-routing";

export const snapshot = (text) => ({
  uri: "file:///peer",
  text,
  version: 1,
  environmentGeneration: "env",
});
export const limits = { work: 1000, depth: 4, diagnostics: 8 };
export const profile = (allowedGuests, defaultGuest) => ({
  version: 1,
  hostLanguageId: "host",
  position: "expression",
  open: "{",
  close: "}",
  allowedGuests,
  ...(defaultGuest ? { defaultGuest } : {}),
});
export const request = (text, start, explicitGuest, overrides = {}) => ({
  snapshot: snapshot(text),
  hostLanguageId: "host",
  slots: [{ position: "expression", start, explicitGuest }],
  isCurrent: () => true,
  limits,
  ...overrides,
});

// This lexer is deliberately independent of Kalada syntax and charges every examined code unit.
export const tiny = {
  languageId: "tiny",
  parse({ snapshot: { text }, start, close, meter }) {
    let cursor = start;
    let expectDigit = true;
    let digits = 0;
    while (cursor < text.length && !text.startsWith(close, cursor)) {
      if (!meter.charge(1)) break;
      const char = text[cursor++];
      if (char >= "0" && char <= "9") {
        digits++;
        expectDigit = false;
        continue;
      }
      if (!expectDigit && char === "+") {
        expectDigit = true;
        continue;
      }
      break;
    }
    const valid = !expectDigit && cursor < text.length && text.startsWith(close, cursor);
    return {
      owner: "tiny",
      status: valid ? "valid" : "invalid",
      reason: valid ? "host-close" : "tiny-invalid",
      stop: cursor,
      range: { start, end: cursor },
      diagnostics: [],
      ...(valid ? { subtree: { kind: "decimal-plus", digits } } : {}),
    };
  },
};

export function kaladaGuest(parsePrefix) {
  const failedStatus = (reason) => {
    if (reason === "limit") return "partial";
    if (reason.startsWith("unsupported")) return "unsupported";
    return "invalid";
  };
  return {
    languageId: "kalada",
    parse({ snapshot: { text }, start, close, meter }) {
      const prefix = parsePrefix(text, start);
      // The syntax API does not accept a router meter: charge its entire scanned prefix once.
      if (!meter.charge(Math.max(1, prefix.stop - start))) {
        return {
          owner: "kalada",
          status: "invalid",
          stop: start,
          range: { start, end: start },
          reason: "limit",
          diagnostics: [],
        };
      }
      const valid =
        prefix.ok && prefix.reason === "outer-brace" && text.startsWith(close, prefix.stop);
      const diagnostics = prefix.diagnostics.map(({ code, range }) => ({
        owner: "kalada",
        code,
        range,
      }));
      return {
        owner: "kalada",
        status: valid ? "valid" : failedStatus(prefix.reason),
        stop: prefix.stop,
        range: prefix.range,
        reason: valid ? "host-close" : prefix.reason,
        diagnostics,
        ...(valid ? { subtree: prefix.parsed } : {}),
      };
    },
  };
}

export const router = (guests, profiles = [profile(guests.map((guest) => guest.languageId))]) =>
  createCompositionRouter(profiles, guests);

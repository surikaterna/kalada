// Independent whole-document recognizer for the *restricted* tiny host grammar.
// It does not share the delegated scanner or represent any production host.
export function integratedTiny(source: string) {
  const match = /^(host\{)([ \t]*[0-9]+(?:[ \t]*\+[ \t]*[0-9]+)*[ \t]*)(\}[^{}]*)$/u.exec(source);
  if (!match) return { status: "invalid", stop: null, ranges: [], errors: ["MALFORMED_DOCUMENT"] };
  const stop = match[1].length + match[2].length;
  return {
    status: "valid",
    stop,
    ranges: [
      [0, match[1].length],
      [match[1].length, stop],
      [stop, source.length],
    ],
    errors: [],
  };
}

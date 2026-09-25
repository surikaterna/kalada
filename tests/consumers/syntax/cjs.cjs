const syntax = require("@kalada/syntax");
const parsed = syntax.parseKaladaV1Expression("1+2*3");
const lowered = syntax.lowerKaladaV1Expression(parsed);
if (
  !lowered.ok ||
  lowered.program.expression.kind !== "numeric-binary" ||
  lowered.resultType.name !== "number"
) {
  throw new Error("CJS lowering failed");
}
const source = '{"}" + "x"}TAIL';
const guest = syntax.experimentalParseKaladaV1GuestExpressionPrefix(source, 1);
if (
  !guest.ok ||
  source[guest.stop] !== "}" ||
  source.slice(guest.stop + 1) !== "TAIL" ||
  guest.range.end !== guest.stop ||
  guest.parsed.document.source !== source
) {
  throw new Error("CJS guest boundary failed");
}
const invalid = syntax.experimentalParseKaladaV1GuestExpressionPrefix("{'bad}TAIL", 1);
if (invalid.ok || invalid.reason !== "unsupported-quote" || invalid.stop !== 1) {
  throw new Error("CJS unsupported guest accepted");
}

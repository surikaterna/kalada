import {
  experimentalParseKaladaV1GuestExpressionPrefix,
  formatKaladaV1Expression,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";

const parsed = parseKaladaV1Expression("(1+2)*3");
const lowered = lowerKaladaV1Expression(parsed);
const formatted = formatKaladaV1Expression(" (1+2)*3 ");
if (!lowered.ok || !formatted.ok) throw new Error("Browser syntax failed");
const source = '🚀{"}" == "}" ? 1 + 2 : 0}TAIL';
const guest = experimentalParseKaladaV1GuestExpressionPrefix(source, 3);
if (
  !guest.ok ||
  guest.stop !== source.indexOf("}TAIL") ||
  guest.range.start !== 3 ||
  !lowerKaladaV1Expression(guest.parsed).ok
)
  throw new Error("Browser guest syntax failed");
globalThis.syntaxBrowserOutcome = {
  kind: lowered.program.expression.kind,
  resultType: lowered.resultType,
  text: formatted.text,
};

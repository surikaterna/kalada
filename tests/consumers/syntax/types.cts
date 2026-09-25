import syntax = require("@kalada/syntax");

const parsed: syntax.KaladaParseResult = syntax.parseKaladaV1Expression("true");
const guest: syntax.ExperimentalKaladaV1GuestPrefixResult =
  syntax.experimentalParseKaladaV1GuestExpressionPrefix("{true}", 1);
void guest.stop;
const formatted: syntax.KaladaFormatOutcome = syntax.formatKaladaV1Expression(
  parsed.document.source,
);
const lowered: syntax.KaladaLowerOutcome = syntax.lowerKaladaV1Expression(parsed);
const resultType: syntax.KaladaSyntaxStaticType | undefined = lowered.ok
  ? lowered.resultType
  : undefined;
void formatted;
void resultType;

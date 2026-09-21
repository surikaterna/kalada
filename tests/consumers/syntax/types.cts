import syntax = require("@kalada/syntax");

const parsed: syntax.KaladaParseResult = syntax.parseKaladaV1Expression("true");
const formatted: syntax.KaladaFormatOutcome = syntax.formatKaladaV1Expression(
  parsed.document.source,
);
const lowered: syntax.KaladaLowerOutcome = syntax.lowerKaladaV1Expression(parsed);
const resultType: syntax.KaladaSyntaxStaticType | undefined = lowered.ok
  ? lowered.resultType
  : undefined;
void formatted;
void resultType;

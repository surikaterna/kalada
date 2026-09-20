import syntax = require("@kalada/syntax");

const parsed: syntax.KaladaParseResult = syntax.parseKaladaV1Expression("true");
const formatted: syntax.KaladaFormatOutcome = syntax.formatKaladaV1Expression(
  parsed.document.source,
);
void formatted;

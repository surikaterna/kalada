import {
  formatKaladaV1Expression,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";

const parsed = parseKaladaV1Expression("(1+2)*3");
const lowered = lowerKaladaV1Expression(parsed);
const formatted = formatKaladaV1Expression(" (1+2)*3 ");
if (!lowered.ok || !formatted.ok) throw new Error("Browser syntax failed");
globalThis.syntaxBrowserOutcome = {
  kind: lowered.program.expression.kind,
  text: formatted.text,
};

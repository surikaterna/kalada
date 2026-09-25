import { compileKaladaV1Program, Option } from "@kalada/core";
import {
  experimentalParseKaladaV1GuestExpressionPrefix,
  formatKaladaV1Expression,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
  queryKaladaV1Semantics,
} from "@kalada/syntax";

const expected = [
  "DEFAULT_KALADA_SYNTAX_LIMITS",
  "KALADA_SYNTAX_DIAGNOSTIC_MESSAGES",
  "MAXIMUM_KALADA_SYNTAX_LIMITS",
  "experimentalParseKaladaV1GuestExpressionPrefix",
  "formatKaladaV1Expression",
  "lowerKaladaV1Expression",
  "parseKaladaV1Expression",
  "queryKaladaV1Semantics",
].sort();
const actual = Object.keys(await import("@kalada/syntax")).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("ESM surface drifted");

const parsed = parseKaladaV1Expression("value?.field ?? fallback");
const lowered = lowerKaladaV1Expression(parsed);
const semantics = queryKaladaV1Semantics(parsed);
if (
  !lowered.ok ||
  lowered.program.expression.kind !== "option-coalesce" ||
  lowered.resultType !== "dynamic"
) {
  throw new Error("ESM lowering failed");
}
const compiled = compileKaladaV1Program(lowered.program);
if (!compiled.ok) throw new Error(compiled.diagnostic.code);
const outcome = compiled.value.evaluate((reference) =>
  reference === "value" ? { found: true, value: { field: 0 } } : { found: true, value: 10 },
);
if (!outcome.ok || outcome.value !== 0 || !Option.none || semantics.nodes.length === 0)
  throw new Error("ESM evaluation failed");
const formatted = formatKaladaV1Expression(" value?.field??fallback ");
if (!formatted.ok || formatted.text !== "value?.field ?? fallback") {
  throw new Error("ESM formatting failed");
}

const source = "🚀\r\n$" + '{("}" == "}" ? (1 + 2) * 3 : 0)}TAIL';
const start = source.indexOf("{") + 1;
const guest = experimentalParseKaladaV1GuestExpressionPrefix(source, start);
if (
  !guest.ok ||
  guest.reason !== "outer-brace" ||
  source[guest.stop] !== "}" ||
  source.slice(guest.stop + 1) !== "TAIL" ||
  guest.range.start !== start ||
  guest.range.end !== guest.stop ||
  guest.parsed?.document.source !== source
) {
  throw new Error("ESM guest boundary failed");
}
const guestLowered = lowerKaladaV1Expression(guest.parsed);
if (
  !guestLowered.ok ||
  guestLowered.sourceMap.some(({ range }) => range.start < start || range.end > guest.stop)
) {
  throw new Error("ESM guest lowering provenance failed");
}
for (const text of ["{a // }TAIL", "{(a}TAIL", "{a b}TAIL", "{a + 1"]) {
  if (experimentalParseKaladaV1GuestExpressionPrefix(text, 1).ok)
    throw new Error("Partial guest accepted");
}

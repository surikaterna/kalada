import { compileKaladaV1Program, Option } from "@kalada/core";
import {
  formatKaladaV1Expression,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
} from "@kalada/syntax";

const expected = [
  "DEFAULT_KALADA_SYNTAX_LIMITS",
  "KALADA_SYNTAX_DIAGNOSTIC_MESSAGES",
  "MAXIMUM_KALADA_SYNTAX_LIMITS",
  "formatKaladaV1Expression",
  "lowerKaladaV1Expression",
  "parseKaladaV1Expression",
].sort();
const actual = Object.keys(await import("@kalada/syntax")).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("ESM surface drifted");

const parsed = parseKaladaV1Expression("value?.field ?? fallback");
const lowered = lowerKaladaV1Expression(parsed);
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
if (!outcome.ok || outcome.value !== 0 || !Option.none) throw new Error("ESM evaluation failed");
const formatted = formatKaladaV1Expression(" value?.field??fallback ");
if (!formatted.ok || formatted.text !== "value?.field ?? fallback") {
  throw new Error("ESM formatting failed");
}

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

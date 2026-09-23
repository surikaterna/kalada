import core = require("@kalada/core");
import projection = require("@kalada/projection");
import syntax = require("@kalada/syntax");

const program: core.KaladaV1Program = core.KaladaV1.program(core.KaladaV1.literal(true));
const parsed: syntax.KaladaParseResult = syntax.parseKaladaV1Expression("true");
const projected: projection.ProjectionProgram = projection.ProjectionV1.program(
  projection.ProjectionV1.value(program),
);
void [parsed, projection.compileProjectionV1(projected)];

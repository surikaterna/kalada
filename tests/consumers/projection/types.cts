import core = require("@kalada/core/kalada-v1");
import projection = require("@kalada/projection");
import schema = require("@kalada/projection/projection-v1.schema.json");

const program: projection.ProjectionProgram = projection.ProjectionV1.program(
  projection.ProjectionV1.value(core.KaladaV1.program(core.KaladaV1.literal(schema.$id))),
);
const options: projection.ProjectionV1Options = { limits: { maxOutputBytes: 256 } };
const compiled: projection.ProjectionOutcome<projection.CompiledProjection> =
  projection.compileProjectionV1(program, options);
if (compiled.ok) compiled.value.evaluate(() => ({ found: false }));

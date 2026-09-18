const core = require("@kalada/core/kalada-v1");
const projection = require("@kalada/projection");
const schema = require("@kalada/projection/projection-v1.schema.json");

const expected = [
  "DEFAULT_PROJECTION_V1_LIMITS",
  "MAXIMUM_PROJECTION_V1_LIMITS",
  "PROJECTION_V1_DIAGNOSTIC_MESSAGES",
  "ProjectionV1",
  "canonicalizeProjectionV1",
  "compileProjectionV1",
];
const actual = Object.keys(projection).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected CJS exports: ${actual.join(",")}`);
}
if (schema.$id !== "https://kalada.dev/schemas/projection-v1.schema.json") {
  throw new Error("CJS schema export is unavailable");
}
const K = core.KaladaV1;
const P = projection.ProjectionV1;
const compiled = projection.compileProjectionV1(P.program(P.value(K.program(K.literal(4)))));
const outcome = compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
if (JSON.stringify(outcome) !== '{"ok":true,"value":4}') {
  throw new Error("CJS projection execution mismatch");
}

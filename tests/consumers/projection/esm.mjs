import { createRequire } from "node:module";
import { Instant, KaladaV1 as K, Option } from "@kalada/core/kalada-v1";
import {
  canonicalizeProjectionV1,
  compileProjectionV1,
  DEFAULT_PROJECTION_V1_LIMITS,
  MAXIMUM_PROJECTION_V1_LIMITS,
  ProjectionV1 as P,
  PROJECTION_V1_DIAGNOSTIC_MESSAGES,
} from "@kalada/projection";
import schema from "@kalada/projection/projection-v1.schema.json" with { type: "json" };

const require = createRequire(import.meta.url);
const cjsCore = require("@kalada/core/kalada-v1");
const cjsProjection = require("@kalada/projection");
const expectedExports = [
  "DEFAULT_PROJECTION_V1_LIMITS",
  "MAXIMUM_PROJECTION_V1_LIMITS",
  "PROJECTION_V1_DIAGNOSTIC_MESSAGES",
  "ProjectionV1",
  "canonicalizeProjectionV1",
  "compileProjectionV1",
];
const actualExports = Object.keys(await import("@kalada/projection")).sort();
if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
  throw new Error(`Unexpected ESM exports: ${actualExports.join(",")}`);
}
if (Option !== cjsCore.Option || Option.none() !== cjsCore.Option.none()) {
  throw new Error("Core cross-loader Option identity was not shared");
}
if (schema.$id !== "https://kalada.dev/schemas/projection-v1.schema.json") {
  throw new Error("Projection schema export is unavailable");
}
if (
  !Object.isFrozen(DEFAULT_PROJECTION_V1_LIMITS) ||
  !Object.isFrozen(MAXIMUM_PROJECTION_V1_LIMITS)
) {
  throw new Error("Projection limits are not frozen");
}
if (PROJECTION_V1_DIAGNOSTIC_MESSAGES.PROJECTION_CLOCK_ERROR !== "Projection clock failed.") {
  throw new Error("Projection diagnostics export drifted");
}

const literal = (value) => K.program(K.literal(value));
const reference = (name) => K.program(K.ref(name));
const nested = P.map(
  reference("outer"),
  "item",
  "innerIndex",
  P.object([
    P.entry("value", P.value(reference("item"))),
    P.entry("index", P.value(reference("innerIndex"))),
  ]),
);
const program = P.program(
  P.object([
    P.entry("real", P.value(reference("real"))),
    P.entry("omitted", P.value(reference("none"))),
    P.entry("selected", P.if(literal(true), P.value(literal("yes")), P.value(literal("no")))),
    P.entry("mapped", P.map(literal([[1, 2], [3]]), "outer", "outerIndex", nested)),
  ]),
);
const canonical = canonicalizeProjectionV1(program);
const compiled = compileProjectionV1(program);
if (!canonical.ok || !compiled.ok) throw new Error("Projection did not compile");
const outcome = compiled.value.evaluate((name) => {
  if (name === "real") return { found: true, value: 7 };
  if (name === "none") return { found: true, value: cjsCore.Option.none() };
  return { found: false };
});
const expected = {
  ok: true,
  value: {
    real: 7,
    selected: "yes",
    mapped: [
      [
        { value: 1, index: 0 },
        { value: 2, index: 1 },
      ],
      [{ value: 3, index: 0 }],
    ],
  },
};
if (JSON.stringify(outcome) !== JSON.stringify(expected)) {
  throw new Error(`Projection execution mismatch: ${JSON.stringify(outcome)}`);
}
const omitted = compileProjectionV1(P.program(P.value(reference("none"))));
if (
  !omitted.ok ||
  JSON.stringify(omitted.value.evaluate(() => ({ found: true, value: cjsCore.Option.none() }))) !==
    '{"ok":true,"omitted":true}'
) {
  throw new Error("Cross-loader Option omission was not recognized");
}
const clocked = compileProjectionV1(
  P.program(
    P.if(
      K.program(K.temporalComparison("equal", K.currentInstant(), K.instant(42))),
      P.value(literal(42)),
      P.value(literal(0)),
    ),
  ),
);
if (!clocked.ok) throw new Error("Clock projection did not compile");
const clockOutcome = clocked.value.evaluateWithClock(
  () => ({ found: false }),
  () => Instant.fromMilliseconds(42),
);
if (!clockOutcome.ok || !("value" in clockOutcome) || clockOutcome.value !== 42) {
  throw new Error("Clock projection execution mismatch");
}

const cjsProgram = cjsProjection.ProjectionV1.program(
  cjsProjection.ProjectionV1.value(cjsCore.KaladaV1.program(cjsCore.KaladaV1.ref("some"))),
);
const cjsCompiled = cjsProjection.compileProjectionV1(cjsProgram);
const cjsOutcome = cjsCompiled.ok
  ? cjsCompiled.value.evaluate(() => ({ found: true, value: Option.some("shared") }))
  : cjsCompiled;
if (JSON.stringify(cjsOutcome) !== '{"ok":true,"value":"shared"}') {
  throw new Error("Reverse cross-loader Option identity was not recognized");
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as root from "../packages/core/src/index.js";
import * as kalada from "../packages/core/src/kalada-v1/index.js";
import * as kuery from "../packages/core/src/kuery-v1/index.js";

const fixture = JSON.parse(
  await readFile(resolve(import.meta.dirname, "fixtures/core-0.4.0-compatibility.json"), "utf8"),
);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("published @kalada/core 0.4.0 projection baseline", () => {
  it("pins exact runtime exports and package metadata", async () => {
    expect(Object.keys(root).sort()).toEqual(fixture.runtimeExports.root);
    expect(Object.keys(kuery).sort()).toEqual(fixture.runtimeExports.kueryV1);
    expect(Object.keys(kalada).sort()).toEqual(fixture.runtimeExports.kaladaV1);
    const manifest = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../packages/core/package.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      name: fixture.package.name,
      version: fixture.package.version,
      sideEffects: fixture.package.sideEffects,
      main: fixture.package.main,
      module: fixture.package.module,
      types: fixture.package.types,
      exports: fixture.package.exports,
    });
    for (const field of fixture.package.runtimeDependencyFields)
      expect(manifest[field]).toBeUndefined();
  });

  it("pins schemas, limits, references, ADTs, and diagnostics", () => {
    expect(kalada.DEFAULT_KALADA_V1_LIMITS).toEqual(fixture.limits.kaladaV1);
    expect(kalada.DEFAULT_KALADA_V1_FUNCTION_LIMITS).toEqual(fixture.limits.functions);
    expect(hash(kalada.KALADA_V1_PROGRAM_SCHEMA)).toBe(fixture.schemas.kaladaProgramV1Sha256);
    expect(hash(kalada.KALADA_V1_FUNCTION_PROGRAM_SCHEMA)).toBe(
      fixture.schemas.kaladaFunctionProgramV1Sha256,
    );
    expect(hash(kalada.KALADA_VALUE_V1_SCHEMA)).toBe(fixture.schemas.kaladaValueV1Sha256);

    const binding = kalada.KaladaV1.binding(
      "local",
      kalada.KaladaV1.ref("outside"),
      kalada.KaladaV1.ref("local"),
    );
    expect(kalada.collectKaladaV1Dependencies(binding)).toEqual(fixture.outcomes.dependencies);
    const some = kalada.compileKaladaV1Program(
      kalada.KaladaV1.program(kalada.KaladaV1.Option.some(kalada.KaladaV1.literal({ x: false }))),
    );
    expect(some.ok && some.value.evaluate(() => ({ found: false }))).toEqual(
      fixture.outcomes.optionSome,
    );
    const missing = kalada.compileKaladaV1Program(
      kalada.KaladaV1.program(kalada.KaladaV1.ref("missing")),
    );
    expect(missing.ok && missing.value.evaluate(() => ({ found: false }))).toEqual(
      fixture.outcomes.missing,
    );
  });
});

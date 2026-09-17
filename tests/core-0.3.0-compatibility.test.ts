import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as root from "../packages/core/src/index.js";
import * as kalada from "../packages/core/src/kalada-v1/index.js";
import * as kuery from "../packages/core/src/kuery-v1/index.js";

const fixturePath = resolve(import.meta.dirname, "fixtures/core-0.3.0-compatibility.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const missing = () => ({ found: false as const });
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("published @kalada/core 0.3.0 compatibility", () => {
  it("freezes public exports and permits only additive kalada-v1 exports", () => {
    expect(Object.keys(root).sort()).toEqual(fixture.runtimeExports.root);
    expect(Object.keys(kuery).sort()).toEqual(fixture.runtimeExports.kueryV1);
    expect(Object.keys(kalada)).toEqual(expect.arrayContaining(fixture.runtimeExports.kaladaV1));
  });

  it("freezes package identity, export map, and zero runtime dependencies", async () => {
    const path = resolve(import.meta.dirname, "../packages/core/package.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    expect(manifest).toMatchObject({
      name: fixture.package.name,
      sideEffects: fixture.package.sideEffects,
      main: fixture.package.main,
      module: fixture.package.module,
      types: fixture.package.types,
    });
    expect(Object.keys(manifest.exports).sort()).toEqual(fixture.package.exportKeys);
    for (const field of fixture.package.runtimeDependencyFields)
      expect(manifest[field]).toBeUndefined();
  });

  it("freezes canonicalization and dependency outcomes", () => {
    expect(
      root.canonicalizeKaladaProgramV1({
        format: "kalada-program",
        version: 1,
        profile: "standard-v1",
        expression: { kind: "literal", value: { z: 1, a: true } },
      }),
    ).toEqual(fixture.outcomes.rootCanonicalization);
    expect(
      kuery.canonicalizeExpression({ kind: "literal", value: { z: [1, null], a: true } }),
    ).toEqual(fixture.outcomes.kueryCanonicalization);
    expect(
      kuery.extractExpressionDependencies({
        kind: "op",
        op: "and",
        args: [
          { kind: "ref", ref: "b" },
          { kind: "ref", ref: "a" },
          { kind: "ref", ref: "b" },
        ],
      }),
    ).toEqual(fixture.outcomes.kueryDependencies);
    const expression = kalada.KaladaV1.binding(
      "x",
      kalada.KaladaV1.ref("outside"),
      kalada.KaladaV1.temporalArithmetic(
        "add",
        kalada.KaladaV1.ref("x"),
        kalada.KaladaV1.ref("later"),
      ),
    );
    expect(kalada.collectKaladaV1Dependencies(expression)).toEqual(
      fixture.outcomes.kaladaDependencies,
    );
  });

  it("freezes diagnostics, ADT codecs, and temporal outcomes", () => {
    expect(root.canonicalizeKaladaProgramV1({})).toEqual(fixture.outcomes.rootDiagnostic);
    expect(kuery.canonicalizeExpression({ kind: "ref", ref: "" })).toEqual(
      fixture.outcomes.kueryDiagnostic,
    );
    const invalid = kalada.KaladaV1.program(kalada.KaladaV1.duration(0.5));
    expect(kalada.canonicalizeKaladaV1Program(invalid)).toEqual(fixture.outcomes.kaladaDiagnostic);
    expect(
      kalada.encodeKaladaValue(kalada.Option.some(kalada.Result.err({ reason: "bad" }))),
    ).toEqual(fixture.outcomes.adt);
    const collision = { format: "kalada-value", version: 1, type: "Option", variant: "none" };
    expect(kalada.encodeKaladaValue(collision)).toEqual(fixture.outcomes.collision);
    expect(kalada.encodeKaladaValue(kalada.Instant.fromMilliseconds(-7))).toEqual(
      fixture.outcomes.temporal,
    );
    const expression = kalada.KaladaV1.temporalArithmetic(
      "add",
      kalada.KaladaV1.instant(1),
      kalada.KaladaV1.instant(2),
    );
    const compiled = kalada.compileKaladaV1Program(kalada.KaladaV1.program(expression));
    expect(compiled.ok && compiled.value.evaluate(missing)).toEqual(
      fixture.outcomes.temporalDiagnostic,
    );
  });

  it("freezes schemas and default limits", () => {
    expect(kuery.DEFAULT_EXPRESSION_LIMITS).toEqual(fixture.limits.kueryV1);
    expect(kalada.DEFAULT_KALADA_V1_LIMITS).toEqual(fixture.limits.kaladaV1);
    expect(sha256(kuery.getStandardExpressionJsonSchema())).toBe(fixture.schemas.kueryV1Sha256);
    expect(sha256(kalada.KALADA_V1_PROGRAM_SCHEMA)).toBe(fixture.schemas.kaladaProgramV1Sha256);
    expect(sha256(kalada.KALADA_VALUE_V1_SCHEMA)).toBe(fixture.schemas.kaladaValueV1Sha256);
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KaladaV1 as K } from "@kalada/core/kalada-v1";
import { describe, expect, it } from "vitest";
import { canonicalizeProjectionV1, compileProjectionV1, ProjectionV1 as P } from "./index.js";

const classifications = {
  "missing-reference": "intentional-divergence",
  "undefined-value": "intentional-divergence",
  "null-value": "supported-equivalence",
  "false-value": "supported-equivalence",
  "zero-value": "supported-equivalence",
  "empty-string-value": "supported-equivalence",
  "empty-array-value": "supported-equivalence",
  "empty-object-value": "supported-equivalence",
  "exact-substitution": "supported-equivalence",
  "string-interpolation": "excluded-legacy",
  "true-condition": "supported-equivalence",
  "false-condition": "supported-equivalence",
  "truthy-condition": "intentional-divergence",
  "conditional-chain": "supported-equivalence",
  "optional-false": "intentional-divergence",
  "optional-empty-containers": "intentional-divergence",
  "root-omission": "intentional-divergence",
  "array-omission": "intentional-divergence",
  "ordered-loop": "supported-equivalence",
  "nested-loop-scope": "intentional-divergence",
  "implicit-object-loop": "excluded-legacy",
  merge: "excluded-legacy",
  flatten: "excluded-legacy",
  include: "excluded-legacy",
  "let-binding": "excluded-legacy",
  "javascript-expression": "excluded-legacy",
  "callable-output": "excluded-legacy",
  "hostile-accessor": "intentional-divergence",
  "unsafe-object-key": "intentional-divergence",
  "host-packaging": "intentional-divergence",
  "modules-imports-hooks": "excluded-legacy",
} as const;

describe("SelectTransform migration boundary", () => {
  it("pins all 31 differential classifications", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../../../tests/fixtures/selecttransform-differential.jsonl"),
      "utf8",
    );
    const actual = Object.fromEntries(
      source
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { id: string; classification: string })
        .map(({ id, classification }) => [id, classification]),
    );
    expect(Object.keys(actual)).toHaveLength(31);
    expect(actual).toEqual(classifications);
  });

  it("rejects interpolation, source strings, legacy nodes, and JavaScript payloads", () => {
    const excluded = ["merge", "flatten", "include", "let", "module", "import", "javascript"];
    for (const kind of excluded) {
      expect(canonicalizeProjectionV1(P.program({ kind } as never))).toMatchObject({
        ok: false,
        diagnostic: { code: "PROJECTION_INVALID_INPUT", path: ["root", "kind"] },
      });
    }
    for (const expression of ["{{ value }}", "value + 1", "Function('return 1')()"]) {
      expect(canonicalizeProjectionV1(P.program(P.value(expression as never)))).toMatchObject({
        ok: false,
        diagnostic: { code: "PROJECTION_CORE_ERROR", path: ["root", "expression"] },
      });
    }
  });

  it("keeps missing, undefined, truthiness, and omission outcomes distinct", () => {
    const reference = P.program(P.value(K.program(K.ref("value"))));
    const compiled = compileProjectionV1(reference);
    if (!compiled.ok) throw new Error(compiled.diagnostic.code);
    expect(compiled.value.evaluate(() => ({ found: false }))).toMatchObject({
      ok: false,
      diagnostic: { cause: { code: "KALADA_REFERENCE_MISSING" } },
    });
    expect(
      compiled.value.evaluate((() => ({ found: true, value: undefined })) as never),
    ).toMatchObject({
      ok: false,
      diagnostic: { cause: { code: "KALADA_INVALID_RESULT" } },
    });
    const truthy = compileProjectionV1(
      P.program(P.if(K.program(K.literal(1)), P.value(K.program(K.literal(1))))),
    );
    if (!truthy.ok) throw new Error(truthy.diagnostic.code);
    expect(truthy.value.evaluate(() => ({ found: false }))).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_CONDITION_TYPE" },
    });
    const none = compileProjectionV1(P.program(P.value(K.program(K.Option.none()))));
    if (!none.ok) throw new Error(none.diagnostic.code);
    expect(none.value.evaluate(() => ({ found: false }))).toEqual({ ok: true, omitted: true });
  });
});

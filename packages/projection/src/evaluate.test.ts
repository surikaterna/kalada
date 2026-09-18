import {
  Duration,
  Instant,
  type JsonValue,
  KaladaV1 as K,
  type KaladaV1Resolution,
  Result,
} from "@kalada/core/kalada-v1";
import { describe, expect, it } from "vitest";
import { compileProjectionV1, ProjectionV1 as P } from "./index.js";
import type { CompiledProjection, ProjectionNode, ProjectionV1Options } from "./types.js";

const missing = (): KaladaV1Resolution => ({ found: false });
const literal = (value: JsonValue) => K.program(K.literal(value));
const value = (input: JsonValue) => P.value(literal(input));

function compile(node: ProjectionNode, options?: ProjectionV1Options): CompiledProjection {
  const outcome = compileProjectionV1(P.program(node), options);
  if (!outcome.ok) throw new Error(outcome.diagnostic.code);
  return outcome.value;
}

describe("projection v1 evaluation", () => {
  it("emits JSON snapshots and exact omission envelopes", () => {
    const falsy = compile(
      P.array([value(null), value(false), value(0), value(""), value([]), value({})]),
    );
    expect(falsy.evaluate(missing)).toEqual({ ok: true, value: [null, false, 0, "", [], {}] });

    const none = compile(P.value(K.program(K.Option.none()))).evaluate(missing);
    expect(none).toEqual({ ok: true, omitted: true });
    expect(Object.keys(none)).toEqual(["ok", "omitted"]);

    const some = compile(P.value(K.program(K.Option.some(K.literal({ x: [1] }))))).evaluate(
      missing,
    );
    expect(some).toEqual({ ok: true, value: { x: [1] } });
    if (!some.ok || !("value" in some)) return;
    expect(Object.getPrototypeOf(some.value)).toBeNull();
    expect(Object.isFrozen(some.value)).toBe(true);
    expect(Object.isFrozen((some.value as { x: unknown }).x)).toBe(true);
  });

  it("omits object fields, compacts arrays, and propagates selected omission", () => {
    const node = P.object([
      P.entry("first", value(false)),
      P.entry("gone", P.value(K.program(K.Option.none()))),
      P.entry("items", P.array([value(0), P.value(K.program(K.Option.none())), value(null)])),
    ]);
    const outcome = compile(node).evaluate(missing);
    expect(outcome).toEqual({ ok: true, value: { first: false, items: [0, null] } });
    if (!outcome.ok || !("value" in outcome)) return;
    expect(Object.getPrototypeOf(outcome.value)).toBeNull();
    expect(Object.isFrozen(outcome.value)).toBe(true);
    expect(Object.isFrozen((outcome.value as { items: unknown }).items)).toBe(true);
    expect(compile(P.if(literal(false), value(1))).evaluate(missing)).toEqual({
      ok: true,
      omitted: true,
    });
  });

  it("requires exact booleans and evaluates only the selected branch", () => {
    let calls = 0;
    const selected = compile(
      P.if(literal(false), P.value(K.program(K.ref("unused"))), value("selected")),
    );
    const resolver = () => {
      calls += 1;
      return { found: false } as const;
    };
    expect(selected.evaluate(resolver)).toEqual({
      ok: true,
      value: "selected",
    });
    expect(calls).toBe(0);
    for (const condition of [null, 0, "", [], {}] as JsonValue[]) {
      expect(compile(P.if(literal(condition), value(1))).evaluate(missing)).toMatchObject({
        ok: false,
        diagnostic: { code: "PROJECTION_CONDITION_TYPE", path: ["root", "condition"] },
      });
    }
  });

  it("wraps core failures and rejects every non-JSON value category", () => {
    expect(compile(P.value(K.program(K.ref("missing")))).evaluate(missing)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "PROJECTION_CORE_ERROR",
        path: ["root", "expression"],
        cause: { code: "KALADA_REFERENCE_MISSING" },
      },
    });
    const programs = [
      K.program(K.Result.ok(K.literal(1))),
      K.program(K.instant(1)),
      K.program(K.duration(1)),
      K.program(K.Option.some(K.Result.ok(K.literal(1)))),
    ];
    for (const program of programs) {
      expect(compile(P.value(program)).evaluate(missing)).toMatchObject({
        ok: false,
        diagnostic: { code: "PROJECTION_VALUE_TYPE", path: ["root", "expression"] },
      });
    }
  });

  it("contains hostile resolvers, async values, and staged map execution", () => {
    const reference = compile(P.value(K.program(K.ref("x"))));
    const hostile = new Proxy(() => ({ found: true, value: 1 }), {
      apply: () => {
        throw new Error("secret");
      },
    });
    expect(reference.evaluate(hostile)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_CORE_ERROR", cause: { code: "KALADA_REFERENCE_ERROR" } },
    });
    expect(reference.evaluate((() => Promise.resolve(1)) as never)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_CORE_ERROR", cause: { code: "KALADA_ASYNC_UNSUPPORTED" } },
    });
    expect(reference.evaluate((() => ({ found: true, value: () => 1 })) as never)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_CORE_ERROR", cause: { code: "KALADA_INVALID_RESULT" } },
    });
    const map = compile(P.map(literal([]), "item", "index", value(1)));
    let calls = 0;
    const resolver = () => {
      calls += 1;
      return { found: false } as const;
    };
    expect(map.evaluate(resolver)).toEqual({ ok: true, value: [] });
    expect(calls).toBe(0);
  });

  it("samples one clock before resolution and shares its instant", () => {
    const node = P.array([
      P.if(K.program(K.temporalComparison("equal", K.currentInstant(), K.instant(7))), value(1)),
      P.if(K.program(K.temporalComparison("equal", K.currentInstant(), K.instant(7))), value(2)),
      P.value(K.program(K.ref("resolved"))),
    ]);
    const compiled = compile(node);
    const instant = Instant.fromMilliseconds(7);
    let clocks = 0;
    let resolutions = 0;
    const outcome = compiled.evaluateWithClock(
      () => {
        resolutions += 1;
        return { found: true, value: 3 };
      },
      () => {
        clocks += 1;
        return instant;
      },
    );
    expect(outcome).toEqual({ ok: true, value: [1, 2, 3] });
    expect(clocks).toBe(1);
    expect(resolutions).toBe(1);

    for (const clock of [
      () => {
        throw new Error("secret");
      },
      () => Promise.reject(new Error("secret")),
      () => ({ type: "Instant", milliseconds: 1 }),
    ]) {
      expect(compiled.evaluateWithClock(missing, clock as never)).toEqual({
        ok: false,
        diagnostic: {
          code: "PROJECTION_CLOCK_ERROR",
          path: ["clock"],
          message: "Projection clock failed.",
        },
      });
    }
  });

  it("enforces expression invocation limits and remains reusable", () => {
    const compiled = compile(P.array([value(1), value(2)]), {
      limits: { maxExpressionInvocations: 1 },
    });
    const expected = {
      ok: false,
      diagnostic: { code: "PROJECTION_LIMIT_EXCEEDED", path: ["root", "items", 1, "expression"] },
    };
    expect(compiled.evaluate(missing)).toMatchObject(expected);
    expect(compiled.evaluate(missing)).toMatchObject(expected);
  });

  it("gives child failures precedence over provisional output failures", () => {
    const compiled = compile(P.object([P.entry("key", P.value(K.program(K.ref("missing"))))]), {
      limits: { maxOutputBytes: 1 },
    });
    expect(compiled.evaluate(missing)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "PROJECTION_CORE_ERROR",
        path: ["root", "entries", 0, "value", "expression"],
        cause: { code: "KALADA_REFERENCE_MISSING" },
      },
    });
  });

  it("contains hostile explicit inputs before traversal", () => {
    const compiled = compile(P.value(K.program(K.ref("x"))));
    let resolutions = 0;
    const inputs = Object.defineProperty({}, "instant", {
      get: () => {
        throw new Error("secret");
      },
    });
    expect(
      compiled.evaluate(() => {
        resolutions += 1;
        return { found: true, value: 1 };
      }, inputs),
    ).toEqual({
      ok: false,
      diagnostic: {
        code: "PROJECTION_INVALID_INPUT",
        path: [],
        message: "Projection input is invalid.",
      },
    });
    expect(resolutions).toBe(0);
  });

  it("handles deep values and does not encode temporal or result host values", () => {
    let deep: JsonValue = 0;
    for (let index = 0; index < 70; index += 1) deep = [deep];
    expect(
      compile(P.value(literal(deep)), {
        coreLimits: { maxValueDepth: 100 },
        limits: { maxOutputDepth: 100 },
      }).evaluate(missing),
    ).toMatchObject({ ok: true });
    for (const host of [Result.ok(1), Instant.fromMilliseconds(1), Duration.fromMilliseconds(1)]) {
      expect(
        compile(P.value(K.program(K.ref("x")))).evaluate(() => ({ found: true, value: host })),
      ).toMatchObject({ ok: false, diagnostic: { code: "PROJECTION_VALUE_TYPE" } });
    }
  });
});

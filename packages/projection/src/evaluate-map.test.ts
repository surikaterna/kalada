import { Instant, type JsonValue, KaladaV1 as K, type KaladaV1Resolution } from "@kalada/core";
import { describe, expect, it } from "vitest";
import { compileProjectionV1, ProjectionV1 as P } from "./index.js";
import type { CompiledProjection, ProjectionNode, ProjectionV1Options } from "./types.js";

const missing = (): KaladaV1Resolution => ({ found: false });
const literal = (input: JsonValue) => K.program(K.literal(input));
const reference = (name: string) => K.program(K.ref(name));
const value = (input: JsonValue) => P.value(literal(input));

function compile(node: ProjectionNode, options?: ProjectionV1Options): CompiledProjection {
  const outcome = compileProjectionV1(P.program(node), options);
  if (!outcome.ok) throw new Error(outcome.diagnostic.code);
  return outcome.value;
}

describe("bounded projection map", () => {
  it("evaluates its source once and resolves item and index before the host", () => {
    const compiled = compile(
      P.map(
        reference("item"),
        "item",
        "index",
        P.object([
          P.entry("value", P.value(reference("item"))),
          P.entry("position", P.value(reference("index"))),
        ]),
      ),
    );
    const calls: string[] = [];
    const outcome = compiled.evaluate((name) => {
      calls.push(name);
      return { found: true, value: ["a", "b"] };
    });
    expect(outcome).toEqual({
      ok: true,
      value: [
        { value: "a", position: 0 },
        { value: "b", position: 1 },
      ],
    });
    expect(calls).toEqual(["item"]);
  });

  it("uses nearest nested scope and keeps outer locals visible to nested collections", () => {
    const inner = P.map(
      reference("item"),
      "item",
      "index",
      P.array([P.value(reference("item")), P.value(reference("index"))]),
    );
    const compiled = compile(P.map(literal([[10, 11], [20]]), "item", "index", inner));
    expect(compiled.evaluate(missing)).toEqual({
      ok: true,
      value: [
        [
          [10, 0],
          [11, 1],
        ],
        [[20, 0]],
      ],
    });
  });

  it("compacts omission but preserves null, falsy, and empty values", () => {
    const inputs: JsonValue[] = [null, false, 0, "", [], {}];
    const retained = compile(P.map(literal(inputs), "item", "index", P.value(reference("item"))));
    expect(retained.evaluate(missing)).toEqual({ ok: true, value: inputs });

    const omitted = compile(
      P.map(literal([1, 2, 3]), "item", "index", P.value(K.program(K.Option.none()))),
    );
    expect(omitted.evaluate(missing)).toEqual({ ok: true, value: [] });
  });

  it("requires an array after core evaluation and never starts an invalid collection", () => {
    let bodyCalls = 0;
    const compiled = compile(
      P.map(reference("source"), "item", "index", P.value(reference("body"))),
    );
    expect(
      compiled.evaluate((name) => {
        if (name === "body") bodyCalls += 1;
        return { found: true, value: name === "source" ? {} : 1 };
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_COLLECTION_TYPE", path: ["root", "collection"] },
    });
    expect(bodyCalls).toBe(0);
    expect(compiled.evaluate((() => ({ found: true, value: undefined })) as never)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_CORE_ERROR", cause: { code: "KALADA_INVALID_RESULT" } },
    });
    expect(compiled.evaluate((() => Promise.resolve([])) as never)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_CORE_ERROR", cause: { code: "KALADA_ASYNC_UNSUPPORTED" } },
    });
  });

  it("checks collection length before iteration at inclusive boundaries", () => {
    const options = { limits: { maxCollectionLength: 2 } };
    expect(compile(P.map(literal([]), "x", "i", value(1)), options).evaluate(missing)).toEqual({
      ok: true,
      value: [],
    });
    expect(
      compile(P.map(literal([1, 2]), "x", "i", P.value(reference("x"))), options).evaluate(missing),
    ).toEqual({ ok: true, value: [1, 2] });
    let bodyCalls = 0;
    const above = compile(
      P.map(literal([1, 2, 3]), "x", "i", P.value(reference("host"))),
      options,
    ).evaluate(() => {
      bodyCalls += 1;
      return { found: true, value: 1 };
    });
    expect(above).toEqual({
      ok: false,
      diagnostic: {
        code: "PROJECTION_LIMIT_EXCEEDED",
        path: ["root", "collection"],
        message: "Projection limit exceeded.",
      },
    });
    expect(bodyCalls).toBe(0);
  });

  it("reserves iterations cumulatively before each body, including omissions", () => {
    const body = P.value(K.program(K.Option.none()));
    expect(
      compile(P.map(literal([1, 2]), "x", "i", body), {
        limits: { maxCollectionIterations: 2 },
      }).evaluate(missing),
    ).toEqual({ ok: true, value: [] });
    const above = compile(P.map(literal([1, 2, 3]), "x", "i", body), {
      limits: { maxCollectionIterations: 2 },
    });
    const expected = {
      ok: false,
      diagnostic: {
        code: "PROJECTION_LIMIT_EXCEEDED",
        path: ["root", "body", 2],
        message: "Projection limit exceeded.",
      },
    } as const;
    expect(above.evaluate(missing)).toEqual(expected);
    expect(above.evaluate(missing)).toEqual(expected);
  });

  it("charges nested fan-out and expression invocations across the projection", () => {
    const nested = P.map(reference("outer"), "inner", "innerIndex", P.value(reference("inner")));
    const node = P.map(literal([[1, 2], [3]]), "outer", "outerIndex", nested);
    expect(
      compile(node, { limits: { maxCollectionIterations: 2 } }).evaluate(missing),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_LIMIT_EXCEEDED", path: ["root", "body", 0, "body", 1] },
    });
    expect(
      compile(P.map(literal([1, 2]), "x", "i", P.value(reference("x"))), {
        limits: { maxExpressionInvocations: 2 },
      }).evaluate(missing),
    ).toMatchObject({
      ok: false,
      diagnostic: { path: ["root", "body", 1, "expression"] },
    });
  });

  it("accounts for each mapped occurrence at body,index paths without partial output", () => {
    const node = P.map(literal([1, 2]), "x", "i", P.value(reference("x")));
    expect(
      compile(node, { limits: { maxOutputNodes: 3, maxOutputBytes: 5 } }).evaluate(missing),
    ).toEqual({ ok: true, value: [1, 2] });
    const limited = compile(node, { limits: { maxOutputNodes: 2 } });
    const expected = {
      ok: false,
      diagnostic: {
        code: "PROJECTION_OUTPUT_LIMIT",
        path: ["root", "body", 1, "expression"],
      },
    };
    expect(limited.evaluate(missing)).toMatchObject(expected);
    expect(limited.evaluate(missing)).toMatchObject(expected);
    expect(compile(node, { limits: { maxOutputBytes: 2 } }).evaluate(missing)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_OUTPUT_LIMIT", path: ["root", "body", 1] },
    });

    const nested = P.map(
      literal([1, 2]),
      "outer",
      "outerIndex",
      P.map(literal([0]), "inner", "innerIndex", P.value(reference("outer"))),
    );
    expect(compile(nested, { limits: { maxOutputNodes: 5 } }).evaluate(missing)).toEqual({
      ok: true,
      value: [[1], [2]],
    });
  });

  it.each([
    ["node", { maxOutputNodes: 1 }],
    ["depth", { maxOutputDepth: 1 }],
    ["byte", { maxOutputBytes: 1 }],
  ] as const)("stops at a nested map container %s failure", (_case, limits) => {
    const bodyMap = P.map(literal([1, 2, 3]), "inner", "innerIndex", P.value(reference("body")));
    const nestedBody =
      _case === "depth" ? P.map(literal([0]), "middle", "middleIndex", bodyMap) : bodyMap;
    const nested = P.map(literal([0]), "outer", "outerIndex", nestedBody);
    const compiled = compile(nested, { limits });
    const expected = {
      ok: false,
      diagnostic: {
        code: "PROJECTION_OUTPUT_LIMIT",
        path: _case === "depth" ? ["root", "body", 0, "body", 0] : ["root", "body", 0],
        message: "Projection output limit exceeded.",
      },
    } as const;
    let calls = 0;
    const resolver = () => {
      calls += 1;
      return { found: true, value: calls } as const;
    };
    expect(compiled.evaluate(resolver)).toEqual(expected);
    expect(calls).toBe(0);
    expect(compiled.evaluate(resolver)).toEqual(expected);
    expect(calls).toBe(0);
  });

  it("also stops nested object and array containers before child resolution", () => {
    const containers = [
      [P.array([P.array([P.value(reference("child"))])]), ["root", "items", 0]],
      [
        P.object([P.entry("nested", P.object([P.entry("child", P.value(reference("child")))]))]),
        ["root", "entries", 0, "value"],
      ],
    ] as const;
    for (const [node, path] of containers) {
      let calls = 0;
      const outcome = compile(node, { limits: { maxOutputNodes: 1 } }).evaluate(() => {
        calls += 1;
        return { found: true, value: 1 };
      });
      expect(outcome).toMatchObject({
        ok: false,
        diagnostic: { code: "PROJECTION_OUTPUT_LIMIT", path },
      });
      expect(calls).toBe(0);
      expect("value" in outcome).toBe(false);
    }
  });

  it("fails fast before later items and shares one clock sample", () => {
    const failed = compile(P.map(literal([1, 2, 3]), "item", "index", P.value(reference("host"))));
    let calls = 0;
    expect(
      failed.evaluate(() => {
        calls += 1;
        if (calls === 2) throw new Error("secret");
        return { found: true, value: calls };
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "PROJECTION_CORE_ERROR",
        path: ["root", "body", 1, "expression"],
        cause: { code: "KALADA_REFERENCE_ERROR" },
      },
    });
    expect(calls).toBe(2);

    const timed = compile(
      P.map(
        literal([1, 2]),
        "item",
        "index",
        P.if(
          K.program(K.temporalComparison("equal", K.currentInstant(), K.instant(7))),
          P.value(reference("item")),
        ),
      ),
    );
    let clocks = 0;
    expect(
      timed.evaluateWithClock(missing, () => {
        clocks += 1;
        return Instant.fromMilliseconds(7);
      }),
    ).toEqual({ ok: true, value: [1, 2] });
    expect(clocks).toBe(1);
  });
});

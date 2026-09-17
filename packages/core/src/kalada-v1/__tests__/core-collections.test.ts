import { expect, it, vi } from "vitest";
import { compileKaladaV1Program, KaladaV1, Option } from "../index.js";
import type { JsonValue } from "../json.js";
import type {
  KaladaCoreFunctionName,
  KaladaV1Expression,
  KaladaV1Options,
  KaladaV1Resolution,
} from "../types.js";

const json = KaladaV1.Type.primitive("json");
const boolean = KaladaV1.Type.primitive("boolean");
const number = KaladaV1.Type.primitive("number");
const callbackType = (returns = json) => KaladaV1.Type.function([json, number], returns);
const missing = () => ({ found: false as const });

function callback(returns: typeof json, body: KaladaV1Expression): KaladaV1Expression {
  return KaladaV1.function(
    [KaladaV1.parameter("element", json), KaladaV1.parameter("index", number)],
    returns,
    body,
  );
}

function collectionCall(
  name: KaladaCoreFunctionName,
  input: KaladaV1Expression,
  fn: KaladaV1Expression,
): KaladaV1Expression {
  return KaladaV1.call(KaladaV1.coreFunction(name), [input, fn]);
}

function run(
  expression: KaladaV1Expression,
  options: KaladaV1Options<string> = {},
  resolve: (reference: string) => KaladaV1Resolution = missing,
) {
  const compiled = compileKaladaV1Program(KaladaV1.program(expression), options);
  if (!compiled.ok) return compiled;
  return compiled.value.evaluate(resolve);
}

function sequence(values: readonly (boolean | object)[]) {
  let index = 0;
  return vi.fn(() => ({ found: true as const, value: values[index++] as JsonValue }));
}

it("returns exact empty identities and immutable arrays", () => {
  const neverJson = callback(json, KaladaV1.ref("unreached"));
  const neverBoolean = callback(boolean, KaladaV1.ref("unreached"));
  for (const [name, fn, expected] of [
    ["map", neverJson, []],
    ["filter", neverBoolean, []],
    ["some", neverBoolean, false],
    ["every", neverBoolean, true],
  ] as const) {
    const outcome = run(collectionCall(name, KaladaV1.literal([]), fn));
    expect(outcome).toEqual({ ok: true, value: expected });
    if (outcome.ok && Array.isArray(outcome.value))
      expect(Object.isFrozen(outcome.value)).toBe(true);
  }
});

it("maps in order with finite zero-based indices and accepts higher-order callbacks", () => {
  const indexCallback = callback(json, KaladaV1.ref("index"));
  expect(run(collectionCall("map", KaladaV1.literal([9, 8, 7]), indexCallback))).toEqual({
    ok: true,
    value: [0, 1, 2],
  });

  const maker = KaladaV1.function([], callbackType(), indexCallback);
  const higherOrder = collectionCall("map", KaladaV1.literal([9]), KaladaV1.call(maker, []));
  expect(run(higherOrder)).toEqual({ ok: true, value: [0] });
});

it("maps callback results and filters original values without reordering", () => {
  const mapped = sequence([{ mapped: 1 }, { mapped: 2 }]);
  const map = collectionCall(
    "map",
    KaladaV1.literal(["a", "b"]),
    callback(json, KaladaV1.ref("next")),
  );
  expect(run(map, {}, mapped)).toEqual({ ok: true, value: [{ mapped: 1 }, { mapped: 2 }] });
  expect(mapped).toHaveBeenCalledTimes(2);

  const predicates = sequence([false, true, false, true]);
  const filter = collectionCall(
    "filter",
    KaladaV1.literal([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]),
    callback(boolean, KaladaV1.ref("keep")),
  );
  expect(run(filter, {}, predicates)).toEqual({
    ok: true,
    value: [{ id: 1 }, { id: 3 }],
  });
});

it("short-circuits some and every without resolving skipped callbacks", () => {
  const someResolver = sequence([false, true]);
  const some = collectionCall(
    "some",
    KaladaV1.literal([1, 2, 3, 4]),
    callback(boolean, KaladaV1.ref("predicate")),
  );
  expect(run(some, { limits: { maxEvaluationSteps: 19 } }, someResolver)).toEqual({
    ok: true,
    value: true,
  });
  expect(someResolver).toHaveBeenCalledTimes(2);

  const everyResolver = sequence([true, false]);
  const every = collectionCall(
    "every",
    KaladaV1.literal([1, 2, 3, 4]),
    callback(boolean, KaladaV1.ref("predicate")),
  );
  expect(run(every, { limits: { maxEvaluationSteps: 19 } }, everyResolver)).toEqual({
    ok: true,
    value: false,
  });
  expect(everyResolver).toHaveBeenCalledTimes(2);
});

it("enforces collection length after both argument checks without callback work", () => {
  const fn = callback(json, KaladaV1.ref("element"));
  expect(
    run(collectionCall("map", KaladaV1.literal([1, 2]), fn), {
      limits: { maxCollectionLength: 2 },
    }),
  ).toEqual({ ok: true, value: [1, 2] });
  expect(
    run(collectionCall("map", KaladaV1.literal([1, 2]), fn), {
      limits: { maxCollectionLength: 1, maxEvaluationSteps: 8 },
    }),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_COLLECTION_LIMIT",
      path: ["expression", "arguments", 0],
      context: [],
    },
  });

  const invalidCallback = collectionCall("map", KaladaV1.literal([1, 2]), KaladaV1.ref("bad"));
  expect(
    run(invalidCallback, { limits: { maxCollectionLength: 1 } }, () => ({ found: true, value: 1 })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "arguments", 1] },
  });
});

it("enforces cumulative iteration limits at equal and plus-one boundaries", () => {
  const inner = collectionCall(
    "map",
    KaladaV1.literal([1, 2]),
    callback(json, KaladaV1.ref("element")),
  );
  const nested = collectionCall("map", KaladaV1.literal([1, 2]), callback(json, inner));
  expect(run(nested, { limits: { maxCollectionIterations: 6 } })).toEqual({
    ok: true,
    value: [
      [1, 2],
      [1, 2],
    ],
  });
  expect(run(nested, { limits: { maxCollectionIterations: 5 } })).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_COLLECTION_LIMIT",
      path: ["expression", "arguments", 1, "body"],
    },
  });
});

it("applies iteration checks before visited-element step charges", () => {
  const map = collectionCall(
    "map",
    KaladaV1.literal([1, 2]),
    callback(json, KaladaV1.ref("element")),
  );
  expect(
    run(map, { limits: { maxCollectionIterations: 1, maxEvaluationSteps: 14 } }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_COLLECTION_LIMIT", path: ["expression"] },
  });
  expect(
    run(map, { limits: { maxCollectionIterations: 2, maxEvaluationSteps: 14 } }),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression"] },
  });
});

it("charges the core dispatch, visit, callback body, and both resumes exactly", () => {
  const map = collectionCall("map", KaladaV1.literal([1]), callback(json, KaladaV1.ref("element")));
  expect(run(map, { limits: { maxEvaluationSteps: 14 } })).toEqual({ ok: true, value: [1] });
  expect(run(map, { limits: { maxEvaluationSteps: 13 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_EVALUATION_LIMIT", path: ["expression"] },
  });
});

it("keeps core depth and continuation frames active during callbacks", () => {
  const map = collectionCall("map", KaladaV1.literal([1]), callback(json, KaladaV1.ref("element")));
  expect(run(map, { limits: { maxCallDepth: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CALL_DEPTH_LIMIT", path: ["expression", "arguments", 1] },
  });
  expect(run(map, { limits: { maxCallDepth: 2, maxContinuationFrames: 2 } })).toEqual({
    ok: true,
    value: [1],
  });
  expect(run(map, { limits: { maxContinuationFrames: 1 } })).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_CONTINUATION_LIMIT", path: ["expression", "arguments", 1] },
  });
});

it("validates dynamic inputs and callback contracts", () => {
  const fn = callback(json, KaladaV1.ref("element"));
  expect(
    run(collectionCall("map", KaladaV1.ref("input"), fn), {}, () => ({
      found: true,
      value: false,
    })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "arguments", 0] },
  });

  const invalidMap = collectionCall(
    "map",
    KaladaV1.literal([1]),
    callback(json, KaladaV1.ref("wrong")),
  );
  expect(run(invalidMap, {}, () => ({ found: true, value: Option.none() }))).toMatchObject({
    ok: false,
    diagnostic: {
      code: "KALADA_FUNCTION_TYPE_MISMATCH",
      path: ["expression", "arguments", 1],
    },
  });

  const invalidPredicate = collectionCall(
    "some",
    KaladaV1.literal([1]),
    callback(boolean, KaladaV1.ref("wrong")),
  );
  expect(run(invalidPredicate, {}, () => ({ found: true, value: 1 }))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" },
  });
  expect(
    run(collectionCall("map", KaladaV1.literal([1]), KaladaV1.coreFunction("map"))),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH", path: ["expression", "arguments", 1] },
  });
});

it("validates aggregate map result value limits", () => {
  const aggregate = collectionCall(
    "map",
    KaladaV1.literal([1, 2]),
    callback(json, KaladaV1.ref("large")),
  );
  expect(
    run(aggregate, { limits: { maxValueNodes: 4 } }, () => ({ found: true, value: { a: 1 } })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_LIMIT_EXCEEDED", path: ["expression"] },
  });
});

it("unwinds nested failures with frozen context and exposes no partial output", () => {
  const map = collectionCall(
    "map",
    KaladaV1.literal([1, 2]),
    callback(json, KaladaV1.ref("missing")),
  );
  const outcome = run(map);
  expect(outcome).toMatchObject({
    ok: false,
    diagnostic: {
      context: [
        { kind: "function-call", path: ["expression", "arguments", 1] },
        { kind: "core-call", name: "map", path: ["expression"] },
      ],
    },
  });
  if (!outcome.ok) {
    expect(Object.isFrozen(outcome.diagnostic.context)).toBe(true);
    expect(Object.isFrozen(outcome.diagnostic.context?.[0]?.path)).toBe(true);
  }
});

it("binds, captures, returns, and immediately calls core-function values", () => {
  const returnType = KaladaV1.Type.function(
    [KaladaV1.Type.array(json), callbackType()],
    KaladaV1.Type.array(json),
  );
  const provider = KaladaV1.function([], returnType, KaladaV1.coreFunction("map"));
  const fn = callback(json, KaladaV1.ref("element"));
  const immediate = KaladaV1.call(KaladaV1.call(provider, []), [KaladaV1.literal([1]), fn]);
  expect(run(immediate)).toEqual({ ok: true, value: [1] });

  const capturedProvider = KaladaV1.binding(
    "operator",
    KaladaV1.coreFunction("map"),
    KaladaV1.call(KaladaV1.call(KaladaV1.function([], returnType, KaladaV1.ref("operator")), []), [
      KaladaV1.literal([2]),
      fn,
    ]),
  );
  expect(run(capturedProvider)).toEqual({ ok: true, value: [2] });

  const invoke = KaladaV1.function(
    [KaladaV1.parameter("operator", returnType)],
    KaladaV1.Type.array(json),
    KaladaV1.call(KaladaV1.ref("operator"), [KaladaV1.literal([3]), fn]),
  );
  expect(run(KaladaV1.call(invoke, [KaladaV1.coreFunction("map")]))).toEqual({
    ok: true,
    value: [3],
  });
  expect(run(KaladaV1.coreFunction("map"))).toMatchObject({
    ok: false,
    diagnostic: { code: "KALADA_FUNCTION_ESCAPE", path: ["expression"] },
  });
});

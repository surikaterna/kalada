import { expect, test } from "vitest";
import {
  compileExpression,
  ExpressionProfile,
  ExpressionProfileBuilder,
  generateExpressionJsonSchema,
  type JsonValue,
  standardV1,
  type ValueExpression,
} from "../index.js";
import { literal, op, ref } from "./helpers.js";

test("supports namespaced pure operators and immutable independent snapshots", () => {
  const builder = new ExpressionProfileBuilder("app");
  builder.add({
    name: "app:double",
    arity: 1,
    inputTypes: ["number"],
    resultType: "number",
    execute: ([value]) => (value as number) * 2,
  });
  const first = builder.build();
  builder.add({ name: "app:constant", arity: 0, execute: () => 1 });
  expect(first.has("app:constant")).toBe(false);
  expect(Object.isFrozen(first)).toBe(true);
  expect(compileExpression(op("app:double", literal(3)), { profile: first })).toMatchObject({
    ok: true,
  });
});

test("extends standard-v1 without losing lazy evaluation strategies", () => {
  let customCalls = 0;
  const derived = standardV1.extend("arbitre-v1", [
    {
      name: "arbitre:double",
      arity: 1,
      inputTypes: ["number"],
      resultType: "number",
      execute: ([value]) => {
        customCalls += 1;
        return (value as number) * 2;
      },
    },
  ]);
  const resolveMissing = () => ({ found: false as const });
  const cases: readonly [ValueExpression, JsonValue][] = [
    [op("coalesce", ref("missing"), literal(7)), 7],
    [op("exists", ref("missing")), false],
    [op("and", literal(false), ref("missing")), false],
    [op("or", literal(true), ref("missing")), true],
    [op("if", literal(true), literal("selected"), ref("missing")), "selected"],
    [op("arbitre:double", literal(3)), 6],
  ];
  for (const [expression, expected] of cases) {
    const compiled = compileExpression(expression, { profile: derived });
    expect(compiled.ok && compiled.value.evaluate(resolveMissing)).toEqual({
      ok: true,
      value: expected,
    });
  }
  expect(customCalls).toBe(1);
});

test("rejects extension overrides and leaves base and derived profiles isolated", () => {
  const extra = { name: "arbitre:constant", arity: 0, execute: () => 1 } as const;
  const derived = standardV1.extend("arbitre-v1", [extra]);
  const chained = derived.extend("arbitre-v2", [
    { name: "arbitre:other", arity: 0, execute: () => 2 },
  ]);
  expect(() => standardV1.extend("bad", [{ name: "add", arity: 0, execute: () => 0 }])).toThrow(
    TypeError,
  );
  expect(() => derived.extend("bad", [extra])).toThrow(TypeError);
  expect(standardV1.has("arbitre:constant")).toBe(false);
  expect(derived.has("arbitre:other")).toBe(false);
  expect(chained.has("arbitre:constant")).toBe(true);
  expect(chained.has("arbitre:other")).toBe(true);
  expect(Object.isFrozen(derived)).toBe(true);
  expect(Object.isFrozen(derived.definitions)).toBe(true);
  expect(derived.get("and")?.execute).toBe(standardV1.get("and")?.execute);
  const conditional = compileExpression(
    op("if", literal(false), ref("missing"), literal("selected")),
    {
      profile: chained,
    },
  );
  expect(conditional.ok && conditional.value.evaluate(() => ({ found: false }))).toEqual({
    ok: true,
    value: "selected",
  });
});

test("includes inherited and custom operators in generated schemas", () => {
  const derived = standardV1.extend("arbitre-v1", [
    {
      name: "arbitre:constant",
      arity: 0,
      execute: () => 1,
    },
  ]);
  const schema = generateExpressionJsonSchema(derived) as any;
  const names = schema.$defs.expression.oneOf
    .map((candidate: any) => candidate.properties?.op?.const)
    .filter(Boolean);
  expect(names).toContain("coalesce");
  expect(names).toContain("if");
  expect(names).toContain("arbitre:constant");
  const conditional = schema.$defs.expression.oneOf.find(
    (candidate: any) => candidate.properties?.op?.const === "if",
  );
  expect(conditional.properties.args).toMatchObject({ minItems: 3, maxItems: 3 });
});

test("validates bounded ASCII profile names used in schema identifiers", () => {
  const definition = { name: "app:value", arity: 0, execute: () => null };
  expect(new ExpressionProfile("app:a.b/c-d@v1", [definition]).name).toBe("app:a.b/c-d@v1");
  for (const name of ["", "1app", "bad name", "\ud800", `a${"x".repeat(128)}`]) {
    expect(() => new ExpressionProfile(name, [definition])).toThrow(TypeError);
    expect(() => new ExpressionProfileBuilder(name)).toThrow(TypeError);
  }
  const schema = generateExpressionJsonSchema(
    new ExpressionProfile("app:a.b/c-d@v1", [definition]),
  ) as any;
  expect(schema.$id).toBe("https://kuery.dev/schema/expression/app%3Aa.b%2Fc-d%40v1");
});

test("keeps custom built-in-named handlers eager instead of substituting standard semantics", () => {
  let calls = 0;
  const profile = new ExpressionProfile("custom", [
    {
      name: "and",
      arity: 1,
      execute: () => {
        calls += 1;
        return "custom";
      },
    },
  ]);
  const compiled = compileExpression(op("and", literal(true)), { profile });
  expect(compiled.ok && compiled.value.evaluate(() => ({ found: false }))).toEqual({
    ok: true,
    value: "custom",
  });
  expect(calls).toBe(1);
});

test("does not expose lazy strategy metadata", () => {
  expect(standardV1.get("if")).not.toHaveProperty("strategy");
  expect(standardV1.definitions.every((definition) => !("strategy" in definition))).toBe(true);
});

test("defines structural immutability and treats callback state as producer-owned", () => {
  type StatefulHandler = (() => number) & { delta: number };
  const handler: StatefulHandler = Object.assign(
    function statefulHandler(): number {
      return handler.delta;
    },
    { delta: 1 },
  );
  const profile = new ExpressionProfileBuilder("app")
    .add({ name: "app:value", arity: 0, execute: handler })
    .build();
  expect(Object.isFrozen(profile.get("app:value"))).toBe(true);
  expect(profile.get("app:value")?.execute).toBe(handler);
  handler.delta = 100;
  expect(profile.get("app:value")?.execute).toBe(handler);
  const compiled = compileExpression(op("app:value"), { profile });
  expect(compiled.ok && compiled.value.evaluate(() => ({ found: false }))).toEqual({
    ok: true,
    value: 100,
  });
});

test("rejects duplicate operators and invalid unnamespaced custom names", () => {
  const builder = new ExpressionProfileBuilder("app").add({
    name: "app:x",
    arity: 0,
    execute: () => null,
  });
  expect(() => builder.add({ name: "app:x", arity: 0, execute: () => null })).toThrow(/Duplicate/);
  expect(() => builder.add({ name: "plain", arity: 0, execute: () => null })).toThrow(TypeError);
});

test("rejects non-string names and invalid value-type metadata before use", () => {
  const valid = { name: "app:value", arity: 0, execute: () => null };
  for (const name of [new String("app"), Symbol("app")]) {
    expect(() => new ExpressionProfile(name as never, [valid])).toThrow(TypeError);
    expect(() => new ExpressionProfileBuilder(name as never)).toThrow(TypeError);
    expect(() => new ExpressionProfile("app", [valid]).extend(name as never, [])).toThrow(
      TypeError,
    );
  }
  const profile = new ExpressionProfile("app", [valid]);
  expect(() => profile.get(Symbol("app:value") as never)).toThrow(TypeError);
  expect(() => profile.has({ toString: () => "app:value" } as never)).toThrow(TypeError);
  for (const metadata of [
    { inputTypes: "number" },
    { inputTypes: ["number", "invalid"] },
    { inputTypes: Array(1) },
    { resultType: "invalid" },
  ]) {
    expect(() => new ExpressionProfile("app", [{ ...valid, ...metadata } as never])).toThrow(
      TypeError,
    );
  }
});

function capturedMetadataFixture() {
  const reads = Object.fromEntries(
    ["name", "arity", "minArgs", "maxArgs", "inputTypes", "resultType", "execute"].map((key) => [
      key,
      0,
    ]),
  ) as Record<string, number>;
  const sourceTypes = ["number"];
  let elementReads = 0;
  const proxiedTypes = new Proxy(sourceTypes, {
    get(target, key, receiver) {
      if (key === "0") elementReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const definition = {
    get name() {
      reads.name! += 1;
      return "app:once";
    },
    get arity() {
      reads.arity! += 1;
      return 1;
    },
    get minArgs() {
      reads.minArgs! += 1;
      return undefined;
    },
    get maxArgs() {
      reads.maxArgs! += 1;
      return undefined;
    },
    get inputTypes() {
      reads.inputTypes! += 1;
      return reads.inputTypes === 1 ? proxiedTypes : ["invalid"];
    },
    get resultType() {
      reads.resultType! += 1;
      return reads.resultType === 1 ? "number" : "invalid";
    },
    get execute() {
      reads.execute! += 1;
      return ([value]: readonly JsonValue[]) => value!;
    },
  };
  const builder = new ExpressionProfileBuilder("app").add(definition as never);
  sourceTypes[0] = "invalid";
  const profile = builder.build();
  return { reads, elementReads: () => elementReads, profile };
}

test("captures caller operator metadata and input types exactly once", () => {
  const { reads, elementReads, profile } = capturedMetadataFixture();
  expect(reads).toEqual({
    name: 1,
    arity: 1,
    minArgs: 1,
    maxArgs: 1,
    inputTypes: 1,
    resultType: 1,
    execute: 1,
  });
  expect(elementReads()).toBe(1);
  expect(profile.get("app:once")).toMatchObject({ inputTypes: ["number"], resultType: "number" });
  expect(Object.isFrozen(profile.get("app:once")?.inputTypes)).toBe(true);
});

test("contains throwing, asynchronous, and invalid custom operator results", () => {
  const profile = new ExpressionProfileBuilder("app")
    .add({
      name: "app:throw",
      arity: 0,
      execute: () => {
        throw new Error("secret");
      },
    })
    .add({ name: "app:async", arity: 0, execute: (() => Promise.resolve(1)) as never })
    .add({ name: "app:bad", arity: 0, execute: () => undefined as never })
    .build();
  const run = (name: string) => {
    const compiled = compileExpression(op(name), { profile });
    return compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
  };
  expect(run("app:throw")).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_OPERATOR_ERROR" },
  });
  expect(run("app:async")).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_ASYNC_UNSUPPORTED" },
  });
  expect(run("app:bad")).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_INVALID_RESULT" },
  });
});

test("validates custom input and result metadata", () => {
  const profile = new ExpressionProfileBuilder("app")
    .add({
      name: "app:number",
      arity: 1,
      inputTypes: ["number"],
      resultType: "number",
      execute: ([value]) => value!,
    })
    .add({ name: "app:lies", arity: 0, resultType: "number", execute: () => "no" })
    .build();
  const wrongInput = compileExpression(op("app:number", literal("1")), { profile });
  const wrongResult = compileExpression(op("app:lies"), { profile });
  expect(wrongInput.ok && wrongInput.value.evaluate(() => ({ found: false }))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_TYPE_MISMATCH" },
  });
  expect(wrongResult.ok && wrongResult.value.evaluate(() => ({ found: false }))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_TYPE_MISMATCH" },
  });
});

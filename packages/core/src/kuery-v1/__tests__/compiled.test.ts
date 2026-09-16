import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import {
  canonicalizeExpression,
  compileExpression,
  ExpressionProfileBuilder,
  extractExpressionDependencies,
  standardV1,
  type ValueExpression,
} from "../index.js";
import { literal, op, ref } from "./helpers.js";

test("extracts stable structural dependencies and resolves every reference occurrence", () => {
  const expression = op("add", ref("score"), op("coalesce", ref("score"), ref("fallback")));
  const compiled = compileExpression(expression, { profile: standardV1 });
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  expect(compiled.value.dependencies).toEqual(["score", "fallback"]);
  expect(Object.isFrozen(compiled.value.dependencies)).toBe(true);
  let calls = 0;
  expect(
    compiled.value.evaluate((reference) => {
      calls += 1;
      return { found: true, value: reference === "score" ? 2 : 0 };
    }),
  ).toEqual({ ok: true, value: 4 });
  expect(calls).toBe(2);
});

test("public extraction deduplicates object references structurally", () => {
  type AppRef = { readonly id: string };
  const expression: ValueExpression<AppRef> = {
    kind: "op",
    op: "eq",
    args: [
      { kind: "ref", ref: { id: "a" } },
      { kind: "ref", ref: { id: "a" } },
    ],
  };
  const reference = {
    validate: (value: unknown): value is AppRef =>
      typeof value === "object" && value !== null && "id" in value,
  };
  const canonical = canonicalizeExpression<AppRef>(expression, { reference });
  expect(
    canonical.ok && extractExpressionDependencies<AppRef>(canonical.value, { reference }),
  ).toEqual({ ok: true, value: [{ id: "a" }] });
});

test("distinguishes missing from present null and supports exists/coalesce", () => {
  const resolve = (name: string) =>
    name === "present" ? { found: true as const, value: null } : { found: false as const };
  const exists = compileExpression(op("exists", ref("present")), { profile: standardV1 });
  const missing = compileExpression(ref("missing"), { profile: standardV1 });
  const fallback = compileExpression(op("coalesce", ref("missing"), literal(7)), {
    profile: standardV1,
  });
  expect(exists.ok && exists.value.evaluate(resolve)).toEqual({ ok: true, value: true });
  expect(missing.ok && missing.value.evaluate(resolve)).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_MISSING" },
  });
  expect(fallback.ok && fallback.value.evaluate(resolve)).toEqual({ ok: true, value: 7 });
});

test("composes exists and coalesce around nested expressions that encounter missing", () => {
  const resolve = () => ({ found: false as const });
  const nested = op("add", ref("missing"), literal(1));
  const exists = compileExpression(op("exists", nested), { profile: standardV1 });
  const fallback = compileExpression(op("coalesce", nested, literal(7)), { profile: standardV1 });
  expect(exists.ok && exists.value.evaluate(resolve)).toEqual({ ok: true, value: false });
  expect(fallback.ok && fallback.value.evaluate(resolve)).toEqual({ ok: true, value: 7 });
});

test("accepts the typed explicit undefined missing reason", () => {
  const compiled = compileExpression(ref("missing"), { profile: standardV1 });
  expect(
    compiled.ok && compiled.value.evaluate(() => ({ found: false, reason: undefined })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_MISSING" },
  });
});

test("distinguishes denied references without treating them as missing", () => {
  const compiled = compileExpression(op("coalesce", ref("denied"), literal(7)), {
    profile: standardV1,
  });
  expect(
    compiled.ok && compiled.value.evaluate(() => ({ found: false, reason: "denied" })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_DENIED", path: ["args", 0] },
  });
});

test.each(["exists", "coalesce"])("preserves a multilevel denied path through %s", (outer) => {
  const nested = op("add", literal(1), ref("denied"));
  const expression = outer === "exists" ? op("exists", nested) : op("coalesce", nested, literal(7));
  const compiled = compileExpression(expression, { profile: standardV1 });
  expect(
    compiled.ok && compiled.value.evaluate(() => ({ found: false, reason: "denied" })),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_DENIED", path: ["args", 0, "args", 1] },
  });
});

test("short-circuits logical and coalesce evaluation while dependencies remain static", () => {
  const compiled = compileExpression(op("and", literal(false), ref("not-read")), {
    profile: standardV1,
  });
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  expect(compiled.value.dependencies).toEqual(["not-read"]);
  expect(
    compiled.value.evaluate(() => {
      throw new Error("must not run");
    }),
  ).toEqual({ ok: true, value: false });
});

test.each([true, false])(
  "if evaluates only its %s branch while retaining static dependencies",
  (condition) => {
    const selected = condition ? "true" : "false";
    const skipped = condition ? "false" : "true";
    const expression = op("if", ref("condition"), ref("true"), ref("false"));
    const compiled = compileExpression(expression, { profile: standardV1 });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.dependencies).toEqual(["condition", "true", "false"]);
    const reads: string[] = [];
    expect(
      compiled.value.evaluate((reference) => {
        reads.push(reference);
        if (reference === "condition") return { found: true, value: condition };
        if (reference === selected) return { found: true, value: { selected } };
        return { found: false, reason: "denied" };
      }),
    ).toEqual({ ok: true, value: { selected } });
    expect(reads).toEqual(["condition", selected]);
    expect(reads).not.toContain(skipped);
  },
);

test("if does not execute an unselected operator or charge its evaluation steps", () => {
  let calls = 0;
  const profile = standardV1.extend("if-test-v1", [
    {
      name: "app:throw",
      arity: 0,
      execute: () => {
        calls += 1;
        throw new Error("unselected");
      },
    },
  ]);
  const compiled = compileExpression(op("if", literal(true), literal(7), op("app:throw")), {
    profile,
    limits: { maxEvaluationSteps: 3 },
  });
  expect(
    compiled.ok &&
      compiled.value.evaluate(() => {
        throw new Error("unselected resolver");
      }),
  ).toEqual({
    ok: true,
    value: 7,
  });
  expect(calls).toBe(0);
});

test("if does not call a resolver for its unselected branch", () => {
  let reads = 0;
  const compiled = compileExpression(
    op("if", literal(false), ref("unselected"), literal("selected")),
    {
      profile: standardV1,
    },
  );
  expect(
    compiled.ok &&
      compiled.value.evaluate(() => {
        reads += 1;
        throw new Error("unselected");
      }),
  ).toEqual({ ok: true, value: "selected" });
  expect(reads).toBe(0);
});

test("if propagates errors from its selected operator", () => {
  const profile = standardV1.extend("if-error-v1", [
    {
      name: "app:throw",
      arity: 0,
      execute: () => {
        throw new Error("selected");
      },
    },
  ]);
  const compiled = compileExpression(op("if", literal(true), op("app:throw"), literal(1)), {
    profile,
  });
  expect(compiled.ok && compiled.value.evaluate(() => ({ found: false }))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_OPERATOR_ERROR", path: ["args", 1] },
  });
});

test.each([
  [
    "condition missing",
    op("if", ref("condition"), literal(1), literal(2)),
    "EXPRESSION_REFERENCE_MISSING",
  ],
  [
    "condition denied",
    op("if", ref("condition"), literal(1), literal(2)),
    "EXPRESSION_REFERENCE_DENIED",
  ],
  [
    "selected missing",
    op("if", literal(true), ref("selected"), literal(2)),
    "EXPRESSION_REFERENCE_MISSING",
  ],
  [
    "selected denied",
    op("if", literal(false), literal(1), ref("selected")),
    "EXPRESSION_REFERENCE_DENIED",
  ],
] as const)("if propagates %s", (name, expression, code) => {
  const compiled = compileExpression(expression, { profile: standardV1 });
  const denied = name.includes("denied");
  expect(
    compiled.ok &&
      compiled.value.evaluate(() =>
        denied ? { found: false, reason: "denied" } : { found: false },
      ),
  ).toMatchObject({ ok: false, diagnostic: { code } });
});

test("contains resolver throws, malformed results, async results, and invalid values", () => {
  const compiled = compileExpression(ref("x"), { profile: standardV1 });
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  expect(
    compiled.value.evaluate(() => {
      throw new Error("secret");
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "EXPRESSION_REFERENCE_ERROR" } });
  expect(compiled.value.evaluate(() => ({ found: true }) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_ERROR" },
  });
  expect(
    compiled.value.evaluate((() => Promise.resolve({ found: true, value: 1 })) as never),
  ).toMatchObject({ ok: false, diagnostic: { code: "EXPRESSION_ASYNC_UNSUPPORTED" } });
  expect(compiled.value.evaluate(() => ({ found: true, value: undefined as never }))).toMatchObject(
    { ok: false, diagnostic: { code: "EXPRESSION_INVALID_RESULT" } },
  );
});

test("rejects native Promises even when their catch property is hostile", () => {
  const compiled = compileExpression(ref("x"), { profile: standardV1 });
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const promise = Promise.resolve({ found: true, value: 1 });
  Object.defineProperty(promise, "catch", {
    get() {
      throw new Error("secret");
    },
  });
  expect(compiled.value.evaluate((() => promise) as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_ASYNC_UNSUPPORTED" },
  });
});

test.each(["resolver", "operator"])(
  "rejects suspicious pre-handled Promise from %s without property access",
  async (source) => {
    const promise = Promise.reject(new Error("secret rejection"));
    await promise.catch(() => undefined);
    let getterCalls = 0;
    Object.defineProperty(promise, "constructor", {
      get() {
        getterCalls += 1;
        throw new Error("poisoned");
      },
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const compiled =
        source === "resolver"
          ? compileExpression(ref("x"), { profile: standardV1 })
          : compileExpression(op("app:promise"), {
              profile: new ExpressionProfileBuilder("app")
                .add({ name: "app:promise", arity: 0, execute: () => promise as never })
                .build(),
            });
      expect(compiled.ok && compiled.value.evaluate(() => promise as never)).toMatchObject({
        ok: false,
        diagnostic: { code: "EXPRESSION_ASYNC_UNSUPPORTED" },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getterCalls).toBe(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  },
);

test.each(["same realm", "cross realm"])(
  "consumes ordinary rejected %s Promise results",
  async (realm) => {
    const promise: Promise<unknown> =
      realm === "same realm"
        ? Promise.reject(new Error("secret rejection"))
        : runInNewContext("Promise.reject(new Error('secret rejection'))");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const compiled = compileExpression(ref("x"), { profile: standardV1 });
      expect(compiled.ok && compiled.value.evaluate(() => promise as never)).toMatchObject({
        ok: false,
        diagnostic: { code: "EXPRESSION_ASYNC_UNSUPPORTED" },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  },
);

test("rejects accessor-backed and trap-throwing resolver results without invoking accessors", () => {
  const compiled = compileExpression(ref("x"), { profile: standardV1 });
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  let invoked = false;
  const accessor = Object.defineProperty({ found: true }, "value", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error("secret");
      },
    },
  );
  expect(compiled.value.evaluate(() => accessor as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_ERROR" },
  });
  expect(compiled.value.evaluate(() => proxy as never)).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_REFERENCE_ERROR" },
  });
  expect(invoked).toBe(false);
});

test("enforces evaluation cost", () => {
  const compiled = compileExpression(op("add", literal(1), literal(2)), {
    profile: standardV1,
    limits: { maxEvaluationSteps: 2 },
  });
  expect(compiled.ok && compiled.value.evaluate(() => ({ found: false }))).toMatchObject({
    ok: false,
    diagnostic: { code: "EXPRESSION_EVALUATION_LIMIT" },
  });
});

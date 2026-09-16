import { describe, expect, test } from "vitest";
import { canonicalizeExpression } from "../index.js";
import { literal, op, ref } from "./helpers.js";

describe("strict expression canonicalization", () => {
  test("canonicalizes and deeply freezes finite JSON object literals", () => {
    const result = canonicalizeExpression({ kind: "literal", value: { z: [1, null], a: true } });
    expect(result).toEqual({
      ok: true,
      value: { kind: "literal", value: { a: true, z: [1, null] } },
    });
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.kind === "literal" && result.value.value)).toBe(true);
    }
  });

  test.each([
    ["unknown kind", { kind: "wat" }],
    ["extra keys", { kind: "literal", value: 1, extra: true }],
    ["function", { kind: "literal", value: () => 1 }],
    ["nonfinite", { kind: "literal", value: Number.POSITIVE_INFINITY }],
    ["date", { kind: "literal", value: new Date() }],
    [
      "unsafe key",
      {
        kind: "literal",
        value: Object.defineProperty({}, "constructor", { value: 1, enumerable: true }),
      },
    ],
  ])("rejects %s", (_name, input) => {
    expect(canonicalizeExpression(input)).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_INPUT" },
    });
  });

  test("rejects accessors without invoking them", () => {
    let invoked = false;
    const input = Object.defineProperty({ kind: "literal" }, "value", {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    expect(canonicalizeExpression(input)).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_INPUT" },
    });
    expect(invoked).toBe(false);
  });

  test("rejects Promise AST values structurally without async property access", () => {
    const promise = Promise.resolve(1);
    let getterCalls = 0;
    Object.defineProperty(promise, "constructor", {
      get() {
        getterCalls += 1;
        throw new Error("secret");
      },
    });
    expect(canonicalizeExpression({ kind: "literal", value: promise })).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_INPUT" },
    });
    expect(getterCalls).toBe(0);
  });

  test("rejects sparse arrays, cycles, and throwing proxies", () => {
    const sparse = Array(1);
    const cyclic: Record<string, unknown> = { kind: "literal" };
    cyclic.value = cyclic;
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("secret");
        },
      },
    );
    for (const input of [{ kind: "literal", value: sparse }, cyclic, proxy]) {
      const result = canonicalizeExpression(input);
      expect(result).toMatchObject({ ok: false, diagnostic: { code: "EXPRESSION_INVALID_INPUT" } });
      if (!result.ok) expect(result.diagnostic.message).not.toContain("secret");
    }
  });

  test("rejects over-wide objects before reading their descriptors", () => {
    let descriptorReads = 0;
    const value = new Proxy(
      Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${index}`, index])),
      {
        getOwnPropertyDescriptor(target, key) {
          descriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(
      canonicalizeExpression({ kind: "literal", value }, { limits: { maxNodes: 3 } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED" },
    });
    expect(descriptorReads).toBe(0);
  });

  test.each(["literal", "operator"])(
    "rejects over-budget %s arrays before traps or allocation",
    (kind) => {
      let ownKeyReads = 0;
      let descriptorReads = 0;
      const values =
        kind === "literal"
          ? Array.from({ length: 32 }, () => true)
          : Array.from({ length: 32 }, () => literal(true));
      const array = new Proxy(values, {
        ownKeys(target) {
          ownKeyReads += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          descriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const input =
        kind === "literal"
          ? { kind: "literal", value: array }
          : { kind: "op", op: "and", args: array };
      expect(canonicalizeExpression(input, { limits: { maxNodes: 2 } })).toMatchObject({
        ok: false,
        diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED" },
      });
      expect({ ownKeyReads, descriptorReads }).toEqual({ ownKeyReads: 0, descriptorReads: 1 });
    },
  );

  test.each(["literal", "operator"])(
    "captures the %s array length without ordinary property reads",
    (kind) => {
      let lengthReads = 0;
      let lengthDescriptors = 0;
      const values = kind === "literal" ? [true] : [literal(true)];
      const array = new Proxy(values, {
        get(target, key, receiver) {
          if (key === "length") lengthReads += 1;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          if (key === "length") lengthDescriptors += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const input =
        kind === "literal"
          ? { kind: "literal", value: array }
          : { kind: "op", op: "and", args: array };
      expect(canonicalizeExpression(input)).toMatchObject({ ok: true });
      expect({ lengthReads, lengthDescriptors }).toEqual({ lengthReads: 0, lengthDescriptors: 1 });
    },
  );

  test("enforces depth, node, argument, string, and default reference limits", () => {
    const cases: readonly [unknown, object][] = [
      [op("not", op("not", literal(true))), { limits: { maxDepth: 1 } }],
      [op("and", literal(true), literal(true)), { limits: { maxNodes: 2 } }],
      [op("and", literal(true), literal(true)), { limits: { maxArgs: 1 } }],
      [literal("long"), { limits: { maxStringLength: 3 } }],
      [ref("long"), { limits: { maxReferenceLength: 3 } }],
    ];
    for (const [input, options] of cases) {
      expect(canonicalizeExpression(input, options)).toMatchObject({
        ok: false,
        diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED" },
      });
    }
  });

  test("uses a caller reference guard and canonicalizer", () => {
    type AppRef = { readonly id: string };
    const result = canonicalizeExpression<AppRef>(
      { kind: "ref", ref: { id: " A " } },
      {
        reference: {
          validate: (value): value is AppRef =>
            typeof value === "object" && value !== null && "id" in value,
          canonicalize: (value) => ({ id: value.id.trim().toLowerCase() }),
        },
      },
    );
    expect(result).toEqual({ ok: true, value: { kind: "ref", ref: { id: "a" } } });
  });

  test("charges reference canonicalizer replacements to the shared node and depth limits", () => {
    type AppRef = { readonly id?: string; readonly nested?: { readonly id: string } };
    const reference = {
      validate: (value: unknown): value is AppRef => typeof value === "object" && value !== null,
      canonicalize: () => ({ nested: { id: "x" } }),
    };
    expect(
      canonicalizeExpression<AppRef>(
        { kind: "ref", ref: { id: "x" } },
        {
          reference,
          limits: { maxNodes: 5 },
        },
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED", path: ["ref", "nested"] },
    });
    expect(
      canonicalizeExpression<AppRef>(
        { kind: "ref", ref: { id: "x" } },
        {
          reference,
          limits: { maxDepth: 2 },
        },
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED", path: ["ref", "nested", "id"] },
    });
  });

  test("clones and freezes canonicalizer output before validation", () => {
    type AppRef = { readonly id: string };
    const replacement = { id: "safe" };
    const validated: AppRef[] = [];
    const result = canonicalizeExpression<AppRef>(
      { kind: "ref", ref: { id: "raw" } },
      {
        reference: {
          validate: (value): value is AppRef => {
            if (typeof value !== "object" || value === null || !("id" in value)) return false;
            validated.push(value as AppRef);
            return Object.isFrozen(value);
          },
          canonicalize: () => replacement,
        },
      },
    );
    replacement.id = "mutated";
    expect(result).toEqual({ ok: true, value: { kind: "ref", ref: { id: "safe" } } });
    expect(validated).toHaveLength(2);
    expect(validated.every(Object.isFrozen)).toBe(true);
  });

  test("limits object property key length at its precise path without invoking accessors", () => {
    let invoked = false;
    const value = Object.defineProperty({}, "long", {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    expect(
      canonicalizeExpression({ kind: "literal", value }, { limits: { maxStringLength: 3 } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_INPUT", path: ["value", "long"] },
    });
    expect(invoked).toBe(false);
    expect(
      canonicalizeExpression(literal({ long: 1 }), { limits: { maxStringLength: 3 } }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_LIMIT_EXCEEDED", path: ["value", "long"] },
    });
  });

  test("rejects invalid or throwing reference callbacks without leaking details", () => {
    const invalid = canonicalizeExpression(
      { kind: "ref", ref: "x" },
      { reference: { validate: (_input): _input is string => false } },
    );
    const throwing = canonicalizeExpression(
      { kind: "ref", ref: "x" },
      {
        reference: {
          validate: (_input): _input is string => {
            throw new Error("secret");
          },
        },
      },
    );
    expect(invalid).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_REFERENCE" },
    });
    expect(throwing).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_REFERENCE" },
    });
    if (!throwing.ok) expect(throwing.diagnostic.message).not.toContain("secret");
  });

  test("does not expose accessor-backed references to the caller guard", () => {
    let invoked = false;
    const value = Object.defineProperty({}, "id", {
      enumerable: true,
      get() {
        invoked = true;
        return "x";
      },
    });
    const result = canonicalizeExpression(
      { kind: "ref", ref: value },
      {
        reference: { validate: (_input): _input is { readonly id: string } => true },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "EXPRESSION_INVALID_REFERENCE" },
    });
    expect(invoked).toBe(false);
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type JsonValue, KaladaV1 as K } from "@kalada/core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  canonicalizeProjectionV1,
  compileProjectionV1,
  DEFAULT_PROJECTION_V1_LIMITS,
  ProjectionV1 as P,
  PROJECTION_V1_DIAGNOSTIC_MESSAGES,
  type ProjectionProgram,
} from "./index.js";

const literal = (value: JsonValue) => K.program(K.literal(value));
const reference = (name: string) => K.program(K.ref(name));

describe("projection v1 canonical contracts", () => {
  it("canonicalizes all five nodes and preserves literal strings", () => {
    const input = P.program(
      P.object([
        P.entry("name", P.value(literal("not source"))),
        P.entry("list", P.array([P.if(literal(true), P.value(literal(1)))])),
        P.entry("mapped", P.map(literal([]), "item", "index", P.value(reference("item")))),
      ]),
    );
    const outcome = canonicalizeProjectionV1(input);
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(JSON.parse(JSON.stringify(outcome.value))).toEqual(input);
    expect(Object.getPrototypeOf(outcome.value)).toBeNull();
    expect(Object.isFrozen(outcome.value.root)).toBe(true);
    expect(Object.isFrozen((outcome.value.root as { entries: object }).entries)).toBe(true);
  });

  it("compiles expressions through core and collects stable string dependencies", () => {
    const input = P.program(
      P.array([P.value(reference("a")), P.if(reference("b"), P.value(reference("a")))]),
    );
    const outcome = compileProjectionV1(input);
    expect(outcome).toMatchObject({ ok: true, value: { dependencies: ["a", "b"] } });
    if (!outcome.ok) return;
    expect(Object.isFrozen(outcome.value.dependencies)).toBe(true);
    expect(typeof outcome.value.evaluate).toBe("function");
  });

  it("excludes direct map locals only from body dependencies", () => {
    const input = P.program(
      P.map(
        reference("collection"),
        "item",
        "index",
        P.array([
          P.value(reference("item")),
          P.value(reference("index")),
          P.value(reference("host")),
        ]),
      ),
    );
    expect(compileProjectionV1(input)).toMatchObject({
      ok: true,
      value: { dependencies: ["collection", "host"] },
    });
  });

  it("applies outer map scope to nested collections and bodies", () => {
    const nested = P.map(
      reference("outer"),
      "inner",
      "innerIndex",
      P.array([
        P.value(reference("outer")),
        P.value(reference("outerIndex")),
        P.value(reference("inner")),
        P.value(reference("innerIndex")),
        P.value(reference("host")),
      ]),
    );
    const input = P.program(P.map(reference("source"), "outer", "outerIndex", nested));
    expect(compileProjectionV1(input)).toMatchObject({
      ok: true,
      value: { dependencies: ["source", "host"] },
    });
  });

  it("handles nested shadowing without removing same-named host references outside scope", () => {
    const nested = P.map(
      reference("nestedSource"),
      "value",
      "nestedIndex",
      P.value(reference("value")),
    );
    const scoped = P.map(literal([]), "value", "outerIndex", nested);
    const input = P.program(P.array([scoped, P.value(reference("value"))]));
    expect(compileProjectionV1(input)).toMatchObject({
      ok: true,
      value: { dependencies: ["nestedSource", "value"] },
    });
  });

  it("preserves first-seen host dependency order and deduplicates after scope filtering", () => {
    const mapped = P.map(
      reference("a"),
      "item",
      "index",
      P.array([P.value(reference("z")), P.value(reference("item")), P.value(reference("b"))]),
    );
    const input = P.program(
      P.array([P.value(reference("z")), mapped, P.value(reference("a")), P.value(reference("c"))]),
    );
    expect(compileProjectionV1(input)).toMatchObject({
      ok: true,
      value: { dependencies: ["z", "a", "b", "c"] },
    });
  });

  it("preserves a sanitized, frozen core diagnostic at its projection path", () => {
    const outcome = compileProjectionV1(P.program(P.value({ bad: true } as never)));
    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: "PROJECTION_CORE_ERROR",
        path: ["root", "expression"],
        cause: { code: "KALADA_INVALID_INPUT" },
      },
    });
    if (outcome.ok || !outcome.diagnostic.cause) return;
    expect(Object.isFrozen(outcome.diagnostic.cause)).toBe(true);
    expect(Object.isFrozen(outcome.diagnostic.cause.path)).toBe(true);
  });

  it("rejects accessors, symbols, proxies, cycles, and sparse arrays safely", () => {
    const accessor = { kind: "value" } as Record<string, unknown>;
    Object.defineProperty(accessor, "expression", { enumerable: true, get: () => literal(1) });
    const symbol = { kind: "value", expression: literal(1), [Symbol("x")]: true };
    const sparse = Array(1);
    const cyclic: Record<string, unknown> = { kind: "array", items: [] };
    (cyclic.items as unknown[]).push(cyclic);
    const spoofed = Object.create({ kind: "value" }) as Record<string, unknown>;
    spoofed.expression = literal(1);
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("hostile");
        },
      },
    );
    const cases = [
      [P.program(accessor as never), ["root", "expression"]],
      [P.program(symbol as never), ["root"]],
      [P.program({ kind: "array", items: sparse }), ["root", "items", 0]],
      [P.program(cyclic as never), ["root", "items", 0]],
      [P.program(spoofed as never), ["root"]],
      [proxy, []],
    ] as const;
    for (const [input, path] of cases) {
      expect(canonicalizeProjectionV1(input)).toMatchObject({
        ok: false,
        diagnostic: { code: "PROJECTION_INVALID_INPUT", path },
      });
    }
  });

  it("applies exact key rules and key precedence without visiting rejected values", () => {
    let visited = false;
    const rejected = new Proxy(
      {},
      {
        ownKeys: () => {
          visited = true;
          return [];
        },
      },
    );
    for (const key of ["__proto__", "prototype", "constructor", "0", "4294967294"]) {
      const outcome = canonicalizeProjectionV1(
        P.program(P.object([P.entry(key, rejected as never)])),
      );
      expect(outcome).toMatchObject({ ok: false, diagnostic: { code: "PROJECTION_UNSAFE_KEY" } });
    }
    for (const key of ["00", "01", "-0", "+0", "1.0", "1e0", "4294967295"]) {
      expect(
        canonicalizeProjectionV1(P.program(P.object([P.entry(key, P.value(literal(1)))]))),
      ).toMatchObject({ ok: true });
    }
    expect(visited).toBe(false);
    const duplicate = P.program(
      P.object([P.entry("x", P.value(literal(1))), P.entry("x", P.value(literal(2)))]),
    );
    expect(canonicalizeProjectionV1(duplicate)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_DUPLICATE_KEY", path: ["root", "entries", 1, "key"] },
    });
    const unsafeAccessor = { key: "__proto__" } as Record<string, unknown>;
    Object.defineProperty(unsafeAccessor, "value", {
      enumerable: true,
      get: () => P.value(literal(1)),
    });
    expect(canonicalizeProjectionV1(P.program(P.object([unsafeAccessor as never])))).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_UNSAFE_KEY" },
    });
  });

  it.each([
    ["unsafe", P.entry("__proto__", P.value(literal(1)))],
    ["duplicate", P.entry("first", P.value(literal(1)))],
  ])("finishes an earlier entry value before a later %s key", (_case, later) => {
    const input = P.program(P.object([P.entry("first", P.value({ bad: true } as never)), later]));
    expect(canonicalizeProjectionV1(input)).toMatchObject({
      ok: false,
      diagnostic: {
        code: "PROJECTION_CORE_ERROR",
        path: ["root", "entries", 0, "value", "expression"],
      },
    });
  });

  it("enforces inclusive projection limits and distinct bounded map names", () => {
    const node = P.program(P.array([P.value(literal(1))]));
    expect(canonicalizeProjectionV1(node, { limits: { maxProjectionNodes: 2 } })).toMatchObject({
      ok: true,
    });
    expect(canonicalizeProjectionV1(node, { limits: { maxProjectionNodes: 1 } })).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_LIMIT_EXCEEDED", path: ["root", "items", 0] },
    });
    const names = P.program(P.map(literal([]), "same", "same", P.value(literal(1))));
    expect(canonicalizeProjectionV1(names)).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_INVALID_INPUT", path: ["root", "index"] },
    });
    expect(canonicalizeProjectionV1(node, { limits: { maxProjectionDepth: 257 } })).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_LIMIT_EXCEEDED", path: ["limits", "maxProjectionDepth"] },
    });
  });

  it("bounds depth, entry/item counts, names, and keys at exact paths", () => {
    let deep = P.value(literal(1));
    for (let depth = 0; depth < 257; depth += 1) deep = P.array([deep]);
    const deepOutcome = canonicalizeProjectionV1(P.program(deep), {
      limits: { maxProjectionDepth: 256, maxProjectionNodes: 1_000 },
    });
    expect(deepOutcome).toMatchObject({
      ok: false,
      diagnostic: { code: "PROJECTION_LIMIT_EXCEEDED" },
    });
    expect(
      canonicalizeProjectionV1(P.program(P.object([])), { limits: { maxObjectEntries: 1 } }),
    ).toMatchObject({ ok: true });
    expect(
      canonicalizeProjectionV1(
        P.program(P.object([P.entry("a", P.value(literal(1))), P.entry("b", P.value(literal(2)))])),
        { limits: { maxObjectEntries: 1 } },
      ),
    ).toMatchObject({ ok: false, diagnostic: { path: ["root", "entries"] } });
    expect(
      canonicalizeProjectionV1(P.program(P.array([P.value(literal(1)), P.value(literal(2))])), {
        limits: { maxArrayItems: 1 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { path: ["root", "items"] } });
    const map = P.program(P.map(literal([]), "😀", "i", P.value(literal(1))));
    expect(canonicalizeProjectionV1(map, { limits: { maxNameLength: 1 } })).toMatchObject({
      ok: true,
    });
    expect(
      canonicalizeProjectionV1(P.program(P.object([P.entry("😀a", P.value(literal(1)))])), {
        limits: { maxKeyLength: 1 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { path: ["root", "entries", 0, "key"] } });
  });

  it("keeps public limits and the complete diagnostic table exact", () => {
    expect(Object.keys(DEFAULT_PROJECTION_V1_LIMITS)).toHaveLength(12);
    expect(Object.keys(PROJECTION_V1_DIAGNOSTIC_MESSAGES)).toHaveLength(10);
    expectTypeOf(P.program(P.value(literal(null)))).toMatchTypeOf<ProjectionProgram>();
  });

  it("ships a closed schema agreeing with canonical programs", async () => {
    const schema = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../projection-v1.schema.json"), "utf8"),
    );
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const input = P.program(P.map(literal([]), "item", "index", P.value(reference("item"))));
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...input, extra: true })).toBe(false);
  });
});

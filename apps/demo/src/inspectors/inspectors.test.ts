import { Duration, Instant, Option, Result } from "@kalada/core";
import type { CompiledExpression } from "@kalada/host";
import { describe, expect, it, vi } from "vitest";
import { createDemoEnvironment } from "../schema/environment.js";
import {
  compiledSnapshot,
  cstSnapshot,
  diagnosticsSnapshot,
  environmentSnapshot,
  linkSnapshot,
} from "./artifacts.js";
import { environmentSnapshotValue } from "./environment.js";
import { programSnapshot } from "./program.js";
import { valueJson, valueSnapshot } from "./values.js";

describe("safe inspector snapshots", () => {
  it("redacts source and literals unless explicitly revealed", () => {
    const hidden = JSON.stringify(cstSnapshot('secret + "classified"'));
    expect(hidden).not.toContain("secret");
    expect(hidden).not.toContain("classified");
    const revealed = JSON.stringify(cstSnapshot('secret + "classified"', true));
    expect(revealed).toContain("secret");
    expect(Object.isFrozen(cstSnapshot("data"))).toBe(true);
  });

  it("does not invoke getters or toJSON and represents cycles", () => {
    const getter = vi.fn(() => "SECRET");
    const value: Record<string, unknown> = { visible: 1, toJSON: () => "SECRET" };
    Object.defineProperty(value, "hidden", { enumerable: true, get: getter });
    value.self = value;
    const text = valueJson(value);
    expect(getter).not.toHaveBeenCalled();
    expect(text).not.toContain("SECRET");
    expect(text).toContain("unsupported");
    expect(text).toContain("reference");
  });

  it("tags bigint, undefined, nonfinite values and freezes copies", () => {
    const snapshot = valueSnapshot({ big: 1n, missing: undefined, bad: Number.NaN }) as Record<
      string,
      unknown
    >;
    expect(snapshot).toMatchObject({
      big: { type: "bigint", decimal: "1" },
      missing: { type: "undefined" },
      bad: { type: "nonfinite" },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("uses bounded deterministic collection and text truncation markers", () => {
    const collection = valueSnapshot(
      Array.from({ length: 5000 }, (_, index) => index),
    ) as unknown[];
    expect(collection).toHaveLength(4096);
    expect(collection.at(-1)).toEqual({ type: "truncated" });
    const text = valueJson("x".repeat(300 * 1024));
    expect(text).toContain("text-truncated");
    expect(text.length).toBeLessThanOrEqual(256 * 1024);
  });

  it("allowlists diagnostics without stacks or arbitrary values", () => {
    const getter = vi.fn(() => "SECRET");
    const diagnostic: Record<string, unknown> = {
      code: "SAFE",
      phase: "bind",
      stack: "SECRET",
      value: "SECRET",
    };
    Object.defineProperty(diagnostic, "message", { enumerable: true, get: getter });
    const snapshot = diagnosticsSnapshot([diagnostic]);
    const text = JSON.stringify(snapshot);
    expect(getter).not.toHaveBeenCalled();
    expect(text).toContain("SAFE");
    expect(text).not.toContain("SECRET");
  });

  it("copies and freezes structural environment DTOs without live aliases", async () => {
    const environment = await createDemoEnvironment(
      JSON.stringify({
        type: "object",
        properties: { count: { type: "integer", minimum: 1 } },
        required: ["count"],
      }),
    );
    const snapshot = environmentSnapshot(environment) as {
      schema: { root: unknown; nodes: readonly unknown[] };
      environment: {
        compileProjection: unknown;
        graph: { roots: unknown; nodes: readonly unknown[] };
      };
    };
    expect(snapshot.schema.root).not.toBe(environment.document.root);
    expect(snapshot.environment.compileProjection).not.toBe(
      environment.adapted.environment.compileProjection,
    );
    expect(snapshot.environment.graph.roots).not.toBe(
      environment.adapted.environment.editorGraph.roots,
    );
    expect(JSON.stringify(snapshot)).toContain("properties");
    expect(Object.isFrozen(snapshot.schema.nodes)).toBe(true);
    expect(Object.isFrozen(snapshot.environment.graph.nodes)).toBe(true);
  });

  it("serializes only branded core values as algebraic or temporal DTOs", () => {
    const snapshot = valueSnapshot({
      some: Option.some(1),
      none: Option.none(),
      ok: Result.ok("yes"),
      instant: Instant.fromMilliseconds(10),
      duration: Duration.fromMilliseconds(20),
      lookalike: { type: "Option", variant: "some", value: "plain-json" },
    });
    expect(snapshot).toMatchObject({
      some: { type: "Option", variant: "some", value: 1 },
      none: { type: "Option", variant: "none" },
      ok: { type: "Result", variant: "ok", value: "yes" },
      instant: { type: "Instant", milliseconds: 10 },
      duration: { type: "Duration", milliseconds: 20 },
      lookalike: { type: "Option", variant: "some", value: "plain-json" },
    });
  });

  it("uses exhaustive program fields without invoking accessors or retaining aliases", () => {
    const getter = vi.fn(() => "SECRET");
    const literal = { kind: "literal", value: { nested: "visible" } };
    const compiled: Record<string, unknown> = {
      format: "kalada-host-compiled-expression-v1",
      program: {
        format: "kalada-program",
        version: 1,
        profile: "kalada-v1",
        expression: literal,
      },
      sourceMap: [],
      resultType: "dynamic",
      dependencies: ["demo:data", "SECRET"],
      secret: "SECRET",
    };
    Object.defineProperty(compiled.program, "hidden", { enumerable: true, get: getter });
    const snapshot = compiledSnapshot(compiled as unknown as CompiledExpression, true);
    literal.value.nested = "mutated";
    const encoded = JSON.stringify(snapshot);
    expect(getter).not.toHaveBeenCalled();
    expect(encoded).toContain("visible");
    expect(encoded).not.toContain("mutated");
    expect(encoded).not.toContain("SECRET");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("contains throwing and revoked proxies at every inspector entry", () => {
    const trapNames: string[] = [];
    const hostile = new Proxy(
      {},
      {
        get: () => trapped(trapNames, "get"),
        getOwnPropertyDescriptor: () => trapped(trapNames, "descriptor"),
        getPrototypeOf: () => trapped(trapNames, "prototype"),
        ownKeys: () => trapped(trapNames, "keys"),
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const operations = [
      () => valueSnapshot(hostile),
      () => diagnosticsSnapshot([hostile]),
      () => compiledSnapshot(hostile as unknown as CompiledExpression),
      () => linkSnapshot(hostile as never),
      () => programSnapshot(hostile as never, true),
      () => environmentSnapshot(hostile as never),
      () => environmentSnapshotValue(hostile as never),
      () => cstSnapshot(hostile as unknown as string),
      () => valueSnapshot(revoked.proxy),
      () => diagnosticsSnapshot([revoked.proxy]),
      () => compiledSnapshot(revoked.proxy as unknown as CompiledExpression),
      () => linkSnapshot(revoked.proxy as never),
      () => programSnapshot(revoked.proxy as never, true),
      () => environmentSnapshot(revoked.proxy as never),
      () => environmentSnapshotValue(revoked.proxy as never),
      () => cstSnapshot(revoked.proxy as unknown as string),
    ];
    for (const operation of operations) {
      const encoded = JSON.stringify(operation());
      expect(encoded).toMatch(/unsupported|omitted/u);
      expect(encoded).not.toContain("PROXY_SECRET");
    }
    expect(trapNames.length).toBeGreaterThan(0);
    expect(trapNames).not.toContain("get");
  });

  it("fails closed for ownKeys, descriptor, and nested collection traps", () => {
    const keys = new Proxy(
      {},
      {
        getPrototypeOf: () => Object.prototype,
        ownKeys: () => {
          throw new Error("PROXY_SECRET");
        },
      },
    );
    const descriptor = new Proxy(
      {},
      {
        getPrototypeOf: () => Object.prototype,
        ownKeys: () => ["secret"],
        getOwnPropertyDescriptor: () => {
          throw new Error("PROXY_SECRET");
        },
      },
    );
    for (const value of [[keys], { nested: descriptor }, new Map(), new Set()]) {
      expect(valueSnapshot(value)).toEqual({ type: "unsupported" });
    }
    expect(valueJson([descriptor])).toBe('{\n  "type": "unsupported"\n}');
  });

  it("omits an environment with a hostile nested schema table", async () => {
    const environment = await createDemoEnvironment('{"type":"boolean"}');
    const nodes = new Proxy(environment.document.nodes, {
      ownKeys: () => {
        throw new Error("PROXY_SECRET");
      },
    });
    const hostile = {
      ...environment,
      document: { ...environment.document, nodes },
    };
    expect(environmentSnapshot(hostile)).toEqual({ kind: "omitted" });
    expect(environmentSnapshotValue(hostile)).toEqual({ kind: "omitted" });
  });
});

function trapped(names: string[], name: string): never {
  names.push(name);
  throw new Error("PROXY_SECRET");
}

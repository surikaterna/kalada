import { Duration, Instant, Option, Result } from "@kalada/core";
import type { CompiledExpression } from "@kalada/host";
import { describe, expect, it, vi } from "vitest";
import { createDemoEnvironment } from "../schema/environment.js";
import {
  compiledSnapshot,
  cstSnapshot,
  diagnosticsSnapshot,
  environmentSnapshot,
} from "./artifacts.js";
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
});

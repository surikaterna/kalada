import type { EditorGraph } from "@kalada/host";
import { describe, expect, it } from "vitest";
import { createDemoEnvironment } from "../schema/environment.js";
import { generateCandidate } from "./candidate.js";
import { canonicalInputShape, canonicalShapeBytes } from "./canonical.js";
import { XorShift32 } from "./prng.js";

describe("demo-input-candidate-v1", () => {
  it("matches the xorshift32 and scalar golden vectors", async () => {
    const random = new XorShift32(1);
    expect([random.next(), random.next(), random.next()]).toEqual([270369, 67634689, 2647435461]);
    await expectGenerated({ type: "boolean" }, 1, "true");
    await expectGenerated({ type: "integer" }, 1, "5");
    await expectGenerated({ const: { x: 1 } }, 99, '{"x":1}');
  });

  it("generates required objects and omits optional recursive properties", async () => {
    await expectGenerated(
      {
        type: "object",
        properties: { name: { type: "string", minLength: 2 }, next: { $ref: "#" } },
        required: ["name"],
        additionalProperties: false,
      },
      1,
      '{"name":"aa"}',
    );
    await expectGenerated(
      { type: "object", properties: { next: { $ref: "#" } }, additionalProperties: false },
      1,
      "{}",
    );
  });

  it("covers tuples, unions, bounds, retries, and unsatisfiable generation", async () => {
    const tuple = {
      type: "array",
      prefixItems: [{ const: "x" }, { type: "boolean" }],
      items: false,
      minItems: 2,
      maxItems: 2,
    };
    await expectGenerated(tuple, 1, '["x",true]');
    const union = { oneOf: [{ const: 1 }, { const: 2 }] };
    const environment = await env(union);
    const generated = generateCandidate(
      environment.adapted.environment.editorGraph,
      1,
      environment.validator.validate,
    );
    expect(generated).toMatchObject({ ok: true, bytes: "2" });
    const integer = await env({ type: "integer" });
    let validations = 0;
    const retried = generateCandidate(integer.adapted.environment.editorGraph, 1, (value) => ({
      valid: ++validations === 2 && value === 0,
      code: validations === 2 ? "DATA_VALID" : "DATA_INVALID",
      issues: [],
    }));
    expect(retried).toMatchObject({ ok: true, bytes: "0" });
    expect(validations).toBe(2);
    const impossible = await env({ type: "array", items: { type: "string" }, minItems: 33 });
    expect(
      generateCandidate(
        impossible.adapted.environment.editorGraph,
        1,
        impossible.validator.validate,
      ),
    ).toMatchObject({ ok: false, code: "generation-unsupported" });
  });

  it("uses the frozen numeric intervals and tuple default length", async () => {
    await expectGenerated({ type: "integer", minimum: 100 }, 1, "115");
    await expectGenerated({ type: "number", maximum: -100 }, 1, "-105");
    await expectGenerated({ type: "integer", minimum: 0, exclusiveMinimum: 0, maximum: 2 }, 1, "2");
    await expectGenerated(
      {
        type: "array",
        prefixItems: [{ const: "first" }, { const: "second" }],
        items: false,
        maxItems: 1,
      },
      1,
      '["first"]',
    );
  });

  it("accepts only structurally identical intersection operands", async () => {
    await expectGenerated({ allOf: [{ type: "integer" }, { type: "integer" }] }, 1, "5");
    const different = await env({ allOf: [{ const: 1 }, { enum: [1] }] });
    expect(
      generateCandidate(different.adapted.environment.editorGraph, 1, different.validator.validate),
    ).toMatchObject({ ok: false, code: "generation-unsupported" });
  });

  it("canonicalizes property order independently of source insertion order", async () => {
    const first = await env({
      type: "object",
      properties: { b: { type: "boolean" }, a: { type: "string" } },
      required: ["a", "b"],
    });
    const second = await env({
      required: ["a", "b"],
      properties: { a: { type: "string" }, b: { type: "boolean" } },
      type: "object",
    });
    const left = canonicalShapeBytes(canonicalInputShape(first.adapted.environment.editorGraph));
    const right = canonicalShapeBytes(canonicalInputShape(second.adapted.environment.editorGraph));
    expect(left).toBe(right);
  });

  it("is invariant to IDs, aliases, definitions, and unreachable nodes", async () => {
    const environment = await env({
      $defs: { item: { type: "integer", minimum: 100 } },
      type: "object",
      properties: { value: { $ref: "#/$defs/item" } },
      required: ["value"],
    });
    const original = environment.adapted.environment.editorGraph;
    const renamed = renameAndExtend(original);
    expect(canonicalShapeBytes(canonicalInputShape(renamed))).toBe(
      canonicalShapeBytes(canonicalInputShape(original)),
    );
    expect(generateCandidate(renamed, 1, environment.validator.validate)).toEqual(
      generateCandidate(original, 1, environment.validator.validate),
    );
  });
});

async function expectGenerated(schema: unknown, seed: number, bytes: string): Promise<void> {
  const environment = await env(schema);
  const first = generateCandidate(
    environment.adapted.environment.editorGraph,
    seed,
    environment.validator.validate,
  );
  const second = generateCandidate(
    environment.adapted.environment.editorGraph,
    seed,
    environment.validator.validate,
  );
  expect(first).toMatchObject({ ok: true, bytes });
  expect(second).toEqual(first);
  if (first.ok) expect(environment.validator.validate(first.value).valid).toBe(true);
}

function env(schema: unknown) {
  return createDemoEnvironment(JSON.stringify(schema));
}

function renameAndExtend(graph: EditorGraph): EditorGraph {
  const copy = structuredClone(graph) as unknown as Record<string, unknown>;
  const nodes = copy.nodes as Record<string, unknown>[];
  const definitions = copy.definitions as Record<string, unknown>[];
  const ids = new Map(nodes.map((node, index) => [node.id as string, `renamed-${index}`]));
  const aliases = new Map(
    definitions.map((definition, index) => [definition.name as string, `synthetic-${index}`]),
  );
  rewriteIds(copy, ids);
  rewriteAliases(copy, aliases);
  definitions.reverse();
  nodes.push({
    id: "unreachable",
    path: ["unreachable"],
    kind: "scalar",
    name: "boolean",
    availability: "available",
    evidence: [],
  });
  definitions.push({
    bindingId: "output:ignored",
    name: "output-only",
    nodeId: "unreachable",
    path: ["output"],
  });
  return copy as unknown as EditorGraph;
}

function rewriteIds(value: unknown, ids: ReadonlyMap<string, string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rewriteIds(item, ids);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if ((key === "id" || key === "nodeId") && typeof item === "string" && ids.has(item))
      record[key] = ids.get(item);
    else rewriteIds(item, ids);
  }
}

function rewriteAliases(value: unknown, aliases: ReadonlyMap<string, string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rewriteAliases(item, aliases);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if ((key === "name" || key === "definition") && typeof item === "string" && aliases.has(item))
      record[key] = aliases.get(item);
    else rewriteAliases(item, aliases);
  }
}

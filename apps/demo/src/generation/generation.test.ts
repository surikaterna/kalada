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
    expect(generated.ok).toBe(true);
    expect(["1", "2"]).toContain(generated.bytes);
    const impossible = await env({ type: "array", items: { type: "string" }, minItems: 33 });
    expect(
      generateCandidate(
        impossible.adapted.environment.editorGraph,
        1,
        impossible.validator.validate,
      ),
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

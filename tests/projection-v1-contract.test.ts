import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { canonicalizeKaladaV1Program } from "../packages/core/src/kalada-v1/index.js";

const fixtures = resolve(import.meta.dirname, "fixtures");
const schema = JSON.parse(await readFile(resolve(fixtures, "projection-v1.schema.json"), "utf8"));
const manifest = JSON.parse(
  await readFile(resolve(fixtures, "projection-v1-contract.json"), "utf8"),
);

interface FixtureExample {
  readonly id: string;
  readonly projection: { readonly root: ProjectionNode };
  readonly expected: {
    readonly status: string;
    readonly value?: unknown;
    readonly causeCode?: string;
  };
}

interface MatrixCase {
  readonly id: string;
  readonly topics: readonly string[];
  readonly classification: string;
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const text = await readFile(resolve(fixtures, path), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as T);
}

const contract = {
  $schema: manifest.$schema,
  contract: manifest.contract,
  limits: manifest.limits,
  examples: await readJsonLines<FixtureExample>(manifest.exampleFixture),
  differentialMatrix: await readJsonLines<MatrixCase>(manifest.differentialFixture),
};

interface ProjectionNode {
  readonly kind: string;
  readonly expression?: unknown;
  readonly condition?: unknown;
  readonly collection?: unknown;
  readonly entries?: readonly { readonly value: ProjectionNode }[];
  readonly items?: readonly ProjectionNode[];
  readonly then?: ProjectionNode;
  readonly else?: ProjectionNode;
  readonly body?: ProjectionNode;
}

function programs(node: ProjectionNode): unknown[] {
  const direct = [node.expression, node.condition, node.collection].filter(
    (value) => value !== undefined,
  );
  const entries = node.entries?.flatMap((entry) => programs(entry.value)) ?? [];
  const items = node.items?.flatMap(programs) ?? [];
  const branches = [node.then, node.else, node.body].flatMap((child) =>
    child ? programs(child) : [],
  );
  return [...direct, ...entries, ...items, ...branches];
}

function allNodes(node: ProjectionNode): ProjectionNode[] {
  const entries = node.entries?.flatMap((entry) => allNodes(entry.value)) ?? [];
  const items = node.items?.flatMap(allNodes) ?? [];
  const branches = [node.then, node.else, node.body].flatMap((child) =>
    child ? allNodes(child) : [],
  );
  return [node, ...entries, ...items, ...branches];
}

describe("projection-v1 frozen contract fixtures", () => {
  it("validates the complete fixture against its closed schema", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(contract), JSON.stringify(validate.errors)).toBe(true);
    expect(Object.keys(contract.limits)).toEqual([
      "maxProjectionDepth",
      "maxProjectionNodes",
      "maxObjectEntries",
      "maxArrayItems",
      "maxNameLength",
      "maxKeyLength",
      "maxExpressionInvocations",
      "maxCollectionLength",
      "maxCollectionIterations",
      "maxOutputDepth",
      "maxOutputNodes",
      "maxOutputBytes",
    ]);
  });

  it("uses globally unique stable case identifiers", () => {
    const ids = [
      ...contract.examples.map((example) => example.id),
      ...contract.differentialMatrix.map((entry) => entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every required migration topic and classification", () => {
    const topics = new Set(contract.differentialMatrix.flatMap((entry) => entry.topics));
    for (const topic of [
      "missing",
      "undefined",
      "null",
      "false",
      "zero",
      "empty-string",
      "empty-array",
      "empty-object",
      "substitution",
      "interpolation",
      "truthiness",
      "omission",
      "conditional",
      "loop",
      "nested",
      "merge",
      "flatten",
      "include",
      "let",
      "javascript",
      "packaging",
      "hostile",
    ]) {
      expect(topics.has(topic), `missing topic ${topic}`).toBe(true);
    }
    const classifications = new Set(
      contract.differentialMatrix.map((entry) => entry.classification),
    );
    expect([...classifications].sort()).toEqual([...contract.contract.classifications].sort());
  });

  it("embeds only valid canonical programs with string references", () => {
    const embedded = contract.examples.flatMap((example) => programs(example.projection.root));
    expect(embedded.length).toBeGreaterThan(contract.examples.length);
    for (const program of embedded) {
      expect(canonicalizeKaladaV1Program(program)).toMatchObject({ ok: true });
      const serialized = JSON.stringify(program);
      expect(serialized).not.toContain('"ref":{');
    }
  });

  it("pins all five nodes and omission/error contract examples", () => {
    const nodes: ProjectionNode[] = contract.examples.flatMap((example) =>
      allNodes(example.projection.root),
    );
    expect([...new Set(nodes.map((node) => node.kind))].sort()).toEqual(
      [...contract.contract.nodeKinds].sort(),
    );
    const outcomes = new Set(contract.examples.map((example) => example.expected.status));
    expect([...outcomes].sort()).toEqual(["error", "omitted", "value"]);
    expect(contract.examples.find((example) => example.id === "emit-falsy-json")).toMatchObject({
      expected: { value: [null, false, 0, "", [], {}] },
    });
    expect(
      contract.examples.find((example) => example.id === "missing-is-core-error"),
    ).toMatchObject({ expected: { causeCode: "KALADA_REFERENCE_MISSING" } });
  });
});

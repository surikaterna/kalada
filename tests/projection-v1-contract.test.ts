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
const auditSchema = JSON.parse(await readFile(resolve(fixtures, manifest.auditSchema), "utf8"));

interface FixtureExample {
  readonly id: string;
  readonly projection: { readonly root: ProjectionNode };
  readonly expected: {
    readonly status: string;
    readonly value?: unknown;
    readonly causeCode?: string;
    readonly outcome?: unknown;
  };
}

interface MatrixCase {
  readonly id: string;
  readonly topics: readonly string[];
  readonly classification: string;
}

interface KeyCase {
  readonly id: string;
  readonly key: string;
  readonly accepted: boolean;
}

interface DiagnosticCase {
  readonly id: string;
  readonly code: string;
  readonly message: string;
  readonly cause: object | null;
  readonly frozen: boolean;
  readonly precedence: number;
}

interface AccountingCase {
  readonly id: string;
  readonly shape: string;
  readonly output: unknown;
  readonly sharedIdentity?: boolean;
  readonly discarded?: unknown;
  readonly stats: { readonly depth: number; readonly nodes: number; readonly bytes: number };
  readonly boundaries: Record<"depth" | "nodes" | "bytes", Boundary>;
}

interface Boundary {
  readonly equalLimit: number;
  readonly plusOneLimit: number;
  readonly failurePath: readonly (string | number)[];
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
const auditVectors = {
  keys: await readJsonLines<KeyCase>(manifest.keyFixture),
  diagnostics: await readJsonLines<DiagnosticCase>(manifest.diagnosticFixture),
  accounting: await readJsonLines<AccountingCase>(manifest.accountingFixture),
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

function jsonStats(value: unknown, depth = 0): { depth: number; nodes: number } {
  if (value === null || typeof value !== "object") return { depth, nodes: 1 };
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Readonly<Record<string, unknown>>);
  let maximum = depth;
  let nodes = 1;
  for (const child of children) {
    const stats = jsonStats(child, depth + 1);
    maximum = Math.max(maximum, stats.depth);
    nodes += stats.nodes;
  }
  return { depth: maximum, nodes };
}

function isArrayIndexKey(key: string): boolean {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) return false;
  const value = Number(key);
  return Number.isInteger(value) && value <= 4_294_967_294;
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
      ...auditVectors.keys.map((entry) => entry.id),
      ...auditVectors.diagnostics.map((entry) => entry.id),
      ...auditVectors.accounting.map((entry) => entry.id),
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
    const omitted = contract.examples.find((example) => example.id === "omit-root-none");
    expect(omitted?.expected.outcome).toEqual({ ok: true, omitted: true });
    expect(Object.keys(omitted?.expected.outcome as object)).toEqual(["ok", "omitted"]);
  });

  it("validates closed audit vectors and exact object-key classification", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(auditSchema);
    expect(validate(auditVectors), JSON.stringify(validate.errors)).toBe(true);
    for (const entry of auditVectors.keys) {
      const namedUnsafe = ["__proto__", "prototype", "constructor"].includes(entry.key);
      expect(entry.accepted, entry.id).toBe(!namedUnsafe && !isArrayIndexKey(entry.key));
    }
    const accepted = auditVectors.keys.filter((entry) => entry.accepted).map((entry) => entry.key);
    const output = Object.create(null) as Record<string, number>;
    for (const [index, key] of accepted.entries()) {
      Object.defineProperty(output, key, { enumerable: true, value: index });
    }
    expect(Object.keys(output)).toEqual(accepted);
    expect(Object.keys(JSON.parse(JSON.stringify(output)))).toEqual(accepted);
  });

  it("freezes the complete ten-code diagnostic table", () => {
    const messages = new Map(auditVectors.diagnostics.map((entry) => [entry.code, entry.message]));
    expect([...messages.entries()].sort()).toEqual(
      [
        ["PROJECTION_CLOCK_ERROR", "Projection clock failed."],
        ["PROJECTION_COLLECTION_TYPE", "Projection map collection must evaluate to a JSON array."],
        ["PROJECTION_CONDITION_TYPE", "Projection condition must evaluate to a boolean."],
        ["PROJECTION_CORE_ERROR", "Kalada expression evaluation failed."],
        ["PROJECTION_DUPLICATE_KEY", "Projection object key is duplicated."],
        ["PROJECTION_INVALID_INPUT", "Projection input is invalid."],
        ["PROJECTION_LIMIT_EXCEEDED", "Projection limit exceeded."],
        ["PROJECTION_OUTPUT_LIMIT", "Projection output limit exceeded."],
        ["PROJECTION_UNSAFE_KEY", "Projection object key is unsafe."],
        [
          "PROJECTION_VALUE_TYPE",
          "Projection value must evaluate to JSON, Option.some(JSON), or Option.none.",
        ],
      ].sort(),
    );
    for (const entry of auditVectors.diagnostics) {
      expect(entry.frozen).toBe(true);
      expect(entry.cause === null).toBe(entry.code !== "PROJECTION_CORE_ERROR");
      expect(entry.precedence).toBeGreaterThan(0);
    }
    const byId = new Map(auditVectors.diagnostics.map((entry) => [entry.id, entry]));
    expect(byId.get("diagnostic-core-nested-map")).toMatchObject({
      path: ["root", "body", 2, "expression"],
      cause: { code: "KALADA_REFERENCE_MISSING", path: ["expression"] },
    });
    expect(byId.get("diagnostic-clock")).toMatchObject({ path: ["clock"], precedence: 1 });
    expect(byId.get("diagnostic-key-limit-precedes-unsafe")?.precedence).toBeLessThan(
      byId.get("diagnostic-unsafe-key")?.precedence ?? 0,
    );
    expect(byId.get("diagnostic-unsafe-key")?.precedence).toBeLessThan(
      byId.get("diagnostic-duplicate-key")?.precedence ?? 0,
    );
  });

  it("pins preorder once-per-occurrence output boundaries", () => {
    expect(auditVectors.accounting.map((entry) => entry.shape).sort()).toEqual(
      [
        "constructed-array",
        "constructed-map",
        "constructed-object",
        "nested-value",
        "no-reattachment",
        "omission-rollback",
        "repeated-identity",
        "utf8",
      ].sort(),
    );
    for (const entry of auditVectors.accounting) {
      const value = entry.sharedIdentity ? repeatedIdentityValue() : entry.output;
      const measured = jsonStats(value);
      expect({ ...measured, bytes: Buffer.byteLength(JSON.stringify(value)) }, entry.id).toEqual(
        entry.stats,
      );
      for (const [name, boundary] of Object.entries(entry.boundaries)) {
        const total = entry.stats[name as keyof typeof entry.stats];
        expect(boundary.equalLimit, `${entry.id} ${name} equal`).toBe(total);
        expect(boundary.plusOneLimit, `${entry.id} ${name} +1`).toBe(total - 1);
        expect(boundary.failurePath.length).toBeGreaterThan(0);
      }
      if (entry.discarded !== undefined) {
        expect(Buffer.byteLength(JSON.stringify(entry.discarded))).toBeGreaterThan(0);
      }
    }
  });
});

function repeatedIdentityValue(): unknown {
  const shared = { x: 1 };
  return [shared, shared];
}

import type { EditorGraph, EditorNode } from "@kalada/host";
import type { DataValidation } from "../schema/validator.js";
import { XorShift32 } from "./prng.js";

const BOUNDS = Object.freeze({ depth: 8, states: 1024, collection: 32, attempts: 8 });
export interface GenerationResult {
  readonly ok: boolean;
  readonly code: string;
  readonly value?: unknown;
  readonly bytes?: string;
}
interface Context {
  readonly nodes: Map<string, EditorNode>;
  readonly random: XorShift32;
  states: number;
  readonly active: Set<string>;
}

export function generateCandidate(
  graph: EditorGraph,
  seed: number,
  validate: (value: unknown) => DataValidation,
  bindingId = "demo:data",
): GenerationResult {
  const root = graph.roots.find((entry) => entry.bindingId === bindingId);
  if (!root) return failure("generation-unsupported");
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const random = new XorShift32(seed);
  for (let attempt = 0; attempt < BOUNDS.attempts; attempt += 1) {
    try {
      const context: Context = { nodes, random, states: 0, active: new Set() };
      const value = generateNode(root.nodeId, context, 0);
      const bytes = stableJson(value);
      if (validate(value).valid)
        return Object.freeze({ ok: true, code: "generated", value, bytes });
    } catch (error) {
      if (error instanceof GenerationError && error.code === "generation-unsupported")
        return failure(error.code);
    }
  }
  return failure("generation-exhausted");
}

function generateNode(id: string, context: Context, depth: number): unknown {
  if (depth > BOUNDS.depth || ++context.states > BOUNDS.states)
    throw new GenerationError("generation-exhausted");
  if (context.active.has(id)) throw new GenerationError("generation-exhausted");
  const node = context.nodes.get(id);
  if (node?.availability !== "available") unsupported();
  context.active.add(id);
  try {
    return generateKind(node, context, depth);
  } finally {
    context.active.delete(id);
  }
}

function generateKind(node: EditorNode, context: Context, depth: number): unknown {
  const leaf = generateLeaf(node, context.random);
  if (leaf.matched) return leaf.value;
  return generateComposite(node, context, depth);
}

function generateLeaf(node: EditorNode, random: XorShift32): { matched: boolean; value?: unknown } {
  if (node.kind === "literal") return { matched: true, value: copy(node.value) };
  if (node.kind === "enum")
    return { matched: true, value: copy(node.values[random.next() % node.values.length]) };
  if (node.kind === "scalar") return { matched: true, value: scalar(node, random) };
  if (node.kind === "unconstrained" && node.domain === "json")
    return { matched: true, value: null };
  return { matched: false };
}

function generateComposite(node: EditorNode, context: Context, depth: number): unknown {
  if (node.kind === "object") return object(node, context, depth);
  if (node.kind === "array") return array(node, context, depth);
  if (node.kind === "tuple") return tuple(node, context, depth);
  if (node.kind === "union")
    return generateNode(
      node.variants[context.random.next() % node.variants.length]?.nodeId ?? "",
      context,
      depth,
    );
  if (node.kind === "reference" && node.target)
    return generateNode(node.target.nodeId, context, depth);
  if (node.kind === "wrapper" && (node.wrapper === "readonly" || node.wrapper === "brand"))
    return generateNode(node.inner.nodeId, context, depth);
  if (node.kind === "intersection") return intersection(node, context, depth);
  unsupported();
}

function object(node: Extract<EditorNode, { kind: "object" }>, context: Context, depth: number) {
  const value: Record<string, unknown> = Object.create(null);
  const required = [...node.properties]
    .filter((item) => item.presence === "required" || item.required)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const minimum = constraint(node, "minProperties", 0);
  if (minimum > required.length || required.length > BOUNDS.collection) unsupported();
  for (const property of required)
    value[property.name] = generateNode(property.nodeId, context, depth + 1);
  return value;
}

function array(node: Extract<EditorNode, { kind: "array" }>, context: Context, depth: number) {
  const minimum = constraint(node, "minItems", 0);
  const maximum = constraint(node, "maxItems", BOUNDS.collection);
  if (minimum > maximum || minimum > BOUNDS.collection) unsupported();
  return Array.from({ length: minimum }, () =>
    generateNode(node.element.nodeId, context, depth + 1),
  );
}

function tuple(node: Extract<EditorNode, { kind: "tuple" }>, context: Context, depth: number) {
  const minimum = constraint(node, "minItems", node.items.length);
  const maximum = constraint(node, "maxItems", BOUNDS.collection);
  if (minimum > maximum || minimum > BOUNDS.collection) unsupported();
  const result: unknown[] = [];
  for (let index = 0; index < minimum; index += 1) {
    const edge = node.items[index] ?? node.rest;
    if (!edge) unsupported();
    result.push(generateNode(edge.nodeId, context, depth + 1));
  }
  return result;
}

function intersection(
  node: Extract<EditorNode, { kind: "intersection" }>,
  context: Context,
  depth: number,
): unknown {
  const first = node.operands[0];
  if (!first) unsupported();
  const values = node.operands.map((edge) => generateNode(edge.nodeId, context, depth));
  const encoded = values.map(stableJson);
  if (encoded.some((value) => value !== encoded[0])) unsupported();
  return values[0];
}

function scalar(node: Extract<EditorNode, { kind: "scalar" }>, random: XorShift32): unknown {
  if (node.name === "null") return null;
  if (node.name === "boolean") return (random.next() & 1) === 1;
  if (node.name === "string") {
    const minimum = constraint(node, "minLength", 0);
    const maximum = constraint(node, "maxLength", 4096);
    if (minimum > maximum || minimum > 4096) unsupported();
    return "a".repeat(minimum);
  }
  if (node.name === "integer" || node.name === "number") return number(node, random);
  if (node.name === "json") return null;
  unsupported();
}

function number(node: EditorNode, random: XorShift32): number {
  let lower = Math.ceil(constraint(node, "minimum", -10));
  let upper = Math.floor(constraint(node, "maximum", 10));
  const exclusiveLower = numericConstraint(node, "exclusiveMinimum");
  const exclusiveUpper = numericConstraint(node, "exclusiveMaximum");
  if (exclusiveLower !== undefined) lower = Math.floor(exclusiveLower) + 1;
  if (exclusiveUpper !== undefined) upper = Math.ceil(exclusiveUpper) - 1;
  const width = upper - lower + 1;
  if (
    !Number.isSafeInteger(lower) ||
    !Number.isSafeInteger(upper) ||
    width <= 0 ||
    width > 0x1_0000_0000
  )
    unsupported();
  return lower + (random.next() % width);
}

function constraint(node: EditorNode, key: string, fallback: number): number {
  return numericConstraint(node, key) ?? fallback;
}
function numericConstraint(node: EditorNode, key: string): number | undefined {
  const constraints = node.constraints;
  const value =
    constraints && typeof constraints === "object" && !Array.isArray(constraints)
      ? (constraints as Readonly<Record<string, unknown>>)[key]
      : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function unsupported(): never {
  throw new GenerationError("generation-unsupported");
}
function failure(code: string): GenerationResult {
  return Object.freeze({ ok: false, code });
}
class GenerationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

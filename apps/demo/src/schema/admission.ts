import { DEMO_LIMITS, inspectJson, type JsonMeasurement, parseBoundedJson } from "./limits.js";
import { analyzeReferences } from "./references.js";

const TYPES = new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);
const ANNOTATIONS = new Set(["title", "description", "default", "examples"]);
const NUMBERS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);
const COUNTS = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
]);
const ALLOWED = new Set([
  "$schema",
  "$defs",
  "$ref",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "anyOf",
  "oneOf",
  "allOf",
  "multipleOf",
  ...ANNOTATIONS,
  ...NUMBERS,
  ...COUNTS,
]);

export interface AdmittedSchema {
  readonly schema: boolean | Record<string, unknown>;
  readonly canonical: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly maxNonConsumingPaths: number;
}

export class SchemaAdmissionError extends Error {
  readonly code: string;
  readonly pointer: string;
  constructor(code: string, pointer = "") {
    super(code);
    this.name = "SchemaAdmissionError";
    this.code = code;
    this.pointer = pointer;
  }
}

interface SchemaEntry {
  readonly value: unknown;
  readonly pointer: string;
}
export interface SchemaEdge {
  readonly from: string;
  readonly to: string;
  readonly consuming: boolean;
}

export function admitSchemaText(text: string): AdmittedSchema {
  const value = parseBoundedJson(text, "schema");
  return admitSchema(value);
}

export function admitSchema(value: unknown): AdmittedSchema {
  if (!isSchema(value)) throw new SchemaAdmissionError("SCHEMA_ROOT_TYPE");
  const copy = copyJson(value) as boolean | Record<string, unknown>;
  inspectJson(copy, "schema");
  const { locations, edges } = walkSchema(copy);
  const maxNonConsumingPaths = analyzeReferences(copy, locations, edges);
  return Object.freeze({
    schema: copy,
    canonical: canonicalJson(copy),
    nodeCount: locations.size,
    edgeCount: edges.length,
    maxNonConsumingPaths,
  });
}

export function estimateValidationWork(
  admitted: AdmittedSchema,
  data: unknown,
): Readonly<{ supported: boolean; estimate: number; measurement: JsonMeasurement }> {
  const measurement = inspectJson(data, "data");
  const base = Math.max(1, admitted.maxNonConsumingPaths);
  let estimate = saturatingMultiply(measurement.nodes, admitted.nodeCount);
  for (let index = 0; index <= measurement.depth; index += 1) {
    estimate = saturatingMultiply(estimate, base);
  }
  return Object.freeze({
    supported: estimate <= DEMO_LIMITS.validationWork,
    estimate,
    measurement,
  });
}

function walkSchema(root: boolean | Record<string, unknown>) {
  const stack: SchemaEntry[] = [{ value: root, pointer: "" }];
  const locations = new Map<string, unknown>();
  const edges: SchemaEdge[] = [];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || !isSchema(entry.value))
      throw new SchemaAdmissionError("SCHEMA_VALUE", entry?.pointer);
    locations.set(entry.pointer, entry.value);
    if (locations.size > DEMO_LIMITS.schemaNodes)
      throw new SchemaAdmissionError("SCHEMA_NODE_LIMIT");
    if (typeof entry.value === "boolean") continue;
    validateKeywords(entry.value, entry.pointer);
    pushSchemaChildren(entry, stack, edges);
    if (edges.length > DEMO_LIMITS.schemaEdges) throw new SchemaAdmissionError("SCHEMA_EDGE_LIMIT");
  }
  return { locations, edges };
}

function validateKeywords(schema: Record<string, unknown>, pointer: string): void {
  for (const key of Object.keys(schema)) {
    if (!ALLOWED.has(key))
      throw new SchemaAdmissionError("SCHEMA_UNSUPPORTED_KEYWORD", join(pointer, key));
  }
  validateDialect(schema.$schema, pointer);
  validateType(schema.type, join(pointer, "type"));
  validateArrayKeyword(schema.enum, "SCHEMA_ENUM", pointer, 1);
  validateArrayKeyword(schema.required, "SCHEMA_REQUIRED", pointer, 0, true);
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    validateArrayKeyword(schema[key], "SCHEMA_BRANCHES", pointer, 1);
  }
  validateNumericKeywords(schema, pointer);
  validateContainers(schema, pointer);
  validateAnnotations(schema, pointer);
}

function validateDialect(value: unknown, pointer: string): void {
  if (value === undefined || value === "https://json-schema.org/draft/2020-12/schema") return;
  throw new SchemaAdmissionError("SCHEMA_DIALECT", join(pointer, "$schema"));
}

function validateType(value: unknown, pointer: string): void {
  if (value === undefined) return;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > TYPES.size)
    throw new SchemaAdmissionError("SCHEMA_TYPE", pointer);
  if (values.some((entry) => typeof entry !== "string" || !TYPES.has(entry))) {
    throw new SchemaAdmissionError("SCHEMA_TYPE", pointer);
  }
  if (new Set(values).size !== values.length)
    throw new SchemaAdmissionError("SCHEMA_TYPE", pointer);
}

function validateArrayKeyword(
  value: unknown,
  code: string,
  pointer: string,
  minimum: number,
  unique = false,
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > DEMO_LIMITS.collectionEntries
  ) {
    throw new SchemaAdmissionError(code, pointer);
  }
  if (
    unique &&
    (value.some((item) => typeof item !== "string") || new Set(value).size !== value.length)
  ) {
    throw new SchemaAdmissionError(code, pointer);
  }
}

function validateNumericKeywords(schema: Record<string, unknown>, pointer: string): void {
  for (const key of NUMBERS) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new SchemaAdmissionError("SCHEMA_NUMBER", join(pointer, key));
    }
  }
  const multiple = schema.multipleOf;
  if (
    multiple !== undefined &&
    (typeof multiple !== "number" || !Number.isFinite(multiple) || multiple <= 0)
  ) {
    throw new SchemaAdmissionError("SCHEMA_MULTIPLE", join(pointer, "multipleOf"));
  }
  for (const key of COUNTS) {
    const value = schema[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
      throw new SchemaAdmissionError("SCHEMA_COUNT", join(pointer, key));
    }
  }
}

function validateContainers(schema: Record<string, unknown>, pointer: string): void {
  for (const key of ["$defs", "properties"]) {
    const value = schema[key];
    if (
      value !== undefined &&
      (!plainRecord(value) || Object.keys(value).length > DEMO_LIMITS.collectionEntries)
    ) {
      throw new SchemaAdmissionError("SCHEMA_MAP", join(pointer, key));
    }
  }
  if (schema.$ref !== undefined && typeof schema.$ref !== "string") {
    throw new SchemaAdmissionError("SCHEMA_REF", join(pointer, "$ref"));
  }
  for (const key of ["additionalProperties", "items"]) {
    if (schema[key] !== undefined && !isSchema(schema[key])) {
      throw new SchemaAdmissionError("SCHEMA_VALUE", join(pointer, key));
    }
  }
}

function validateAnnotations(schema: Record<string, unknown>, pointer: string): void {
  for (const key of ["title", "description"]) {
    const value = schema[key];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > DEMO_LIMITS.stringValue)
    ) {
      throw new SchemaAdmissionError("SCHEMA_ANNOTATION", join(pointer, key));
    }
  }
  if (schema.examples !== undefined && !Array.isArray(schema.examples)) {
    throw new SchemaAdmissionError("SCHEMA_ANNOTATION", join(pointer, "examples"));
  }
}

function pushSchemaChildren(entry: SchemaEntry, stack: SchemaEntry[], edges: SchemaEdge[]): void {
  const schema = entry.value as Record<string, unknown>;
  pushMap(schema.$defs, "$defs", entry.pointer, false, stack, edges);
  pushMap(schema.properties, "properties", entry.pointer, true, stack, edges);
  pushOne(schema.additionalProperties, "additionalProperties", entry.pointer, true, stack, edges);
  pushOne(schema.items, "items", entry.pointer, true, stack, edges);
  for (const key of ["prefixItems", "anyOf", "oneOf", "allOf"]) {
    const list = schema[key];
    if (!Array.isArray(list)) continue;
    if (list.length > DEMO_LIMITS.branches && key !== "prefixItems") {
      throw new SchemaAdmissionError("SCHEMA_BRANCH_LIMIT", join(entry.pointer, key));
    }
    for (let index = list.length - 1; index >= 0; index -= 1) {
      pushOne(list[index], `${key}/${index}`, entry.pointer, key === "prefixItems", stack, edges);
    }
  }
}

function pushMap(
  value: unknown,
  key: string,
  parent: string,
  consuming: boolean,
  stack: SchemaEntry[],
  edges: SchemaEdge[],
): void {
  if (!plainRecord(value)) return;
  const names = Object.keys(value).sort().reverse();
  for (const name of names)
    pushOne(value[name], `${key}/${escapePointer(name)}`, parent, consuming, stack, edges);
}

function pushOne(
  value: unknown,
  key: string,
  parent: string,
  consuming: boolean,
  stack: SchemaEntry[],
  edges: SchemaEdge[],
): void {
  if (value === undefined) return;
  if (!isSchema(value)) throw new SchemaAdmissionError("SCHEMA_VALUE", join(parent, key));
  const pointer = join(parent, key);
  stack.push({ value, pointer });
  if (!key.startsWith("$defs/")) edges.push({ from: parent, to: pointer, consuming });
}

function canonicalJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(",")}}`;
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function isSchema(value: unknown): value is boolean | Record<string, unknown> {
  return typeof value === "boolean" || plainRecord(value);
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function join(parent: string, key: string): string {
  return `${parent}/${key}`;
}
function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
function saturatingMultiply(left: number, right: number): number {
  return left > DEMO_LIMITS.validationWork / Math.max(1, right)
    ? DEMO_LIMITS.validationWork + 1
    : left * right;
}

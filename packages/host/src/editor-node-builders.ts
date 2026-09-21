import type {
  EditorEdge,
  EditorNode,
  EditorPropertyEdge,
  EditorUnknownCode,
  HostPath,
} from "./editor-types.js";
import { readArray } from "./input-readers.js";
import { cloneSerializableData, readOwnDataRecord } from "./serializable.js";

export interface NodeBuildContext {
  readonly maximumCollectionSize: number;
  readonly child: (shape: unknown, path: HostPath) => EditorEdge | null;
}

export function withNodeEvidence(
  node: EditorNode,
  record: Record<string, unknown>,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const relations = relationEdges(record.relations, path, context);
  if (!relations) return unknownNode(node.id, path, "invalid-shape");
  const annotations = optionalData(record.annotations);
  const constraints = optionalData(record.constraints);
  if (annotations === null || constraints === null)
    return unknownNode(node.id, path, "invalid-shape");
  return {
    ...node,
    ...(validText(record.sourceId) ? { sourceId: record.sourceId } : {}),
    ...(annotations === undefined ? {} : { annotations }),
    ...(constraints === undefined ? {} : { constraints }),
    relations: Object.freeze(relations),
  } as EditorNode;
}

export function scalarNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode {
  const names = [
    "null",
    "boolean",
    "number",
    "integer",
    "string",
    "undefined",
    "void",
    "bigint",
    "symbol",
    "date",
    "NaN",
    "json",
    "instant",
    "duration",
  ];
  if (typeof record.name !== "string" || !names.includes(record.name)) {
    return unknownNode(id, path, "invalid-shape");
  }
  return { id, path, kind: "scalar", name: record.name as never, ...available() };
}

export function declaredUnknownNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode {
  const reason = typeof record.reason === "string" ? record.reason.slice(0, 256) : undefined;
  return {
    ...unknownNode(id, path, "unsupported-shape"),
    ...(reason === undefined ? {} : { reason }),
  };
}

export function objectNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const items = readArray(record.properties, context.maximumCollectionSize);
  if (!items) return unknownNode(id, path, "invalid-shape");
  const properties: EditorPropertyEdge[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const property = propertyEdge(items[index], index, path, context);
    if (!property) return partialObjectNode(id, path, properties);
    properties.push(property);
  }
  const additionalProperties = optionalChild(record.additionalProperties, [...path, "*"], context);
  if (additionalProperties === null) return partialObjectNode(id, path, properties);
  const requiredNames = stringList(record.requiredNames);
  if (!requiredNames) return unknownNode(id, path, "invalid-shape");
  const unknownKeys = validUnknownKeys(record.unknownKeys) ? record.unknownKeys : undefined;
  return {
    id,
    path,
    kind: "object",
    properties: Object.freeze(properties),
    requiredNames: Object.freeze(requiredNames),
    ...(additionalProperties ? { additionalProperties } : {}),
    ...(unknownKeys ? { unknownKeys } : {}),
    ...available(),
  };
}

function propertyEdge(
  input: unknown,
  index: number,
  path: HostPath,
  context: NodeBuildContext,
): EditorPropertyEdge | null {
  const inspected = readOwnDataRecord(input, 4);
  const record = inspected.ok ? inspected.value : Object.create(null);
  const name = typeof record.name === "string" ? record.name : `<invalid:${index}>`;
  const childPath = freezePath([...path, name]);
  const child = context.child(record.shape, childPath);
  const presence = readPresence(record);
  return child
    ? Object.freeze({ ...child, name, required: presence === "required", presence })
    : null;
}

export function arrayNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const element = context.child(record.element, freezePath([...path, "[]"]));
  return element
    ? { id, path, kind: "array", element, ...available() }
    : unknownNode(id, path, "edge-limit");
}

export function tupleNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const sourceItems = readArray(record.items, context.maximumCollectionSize);
  if (!sourceItems) return unknownNode(id, path, "invalid-shape");
  const built = buildIndexedEdges(sourceItems, path, context);
  if (!built.complete) return partialTupleNode(id, path, built.items);
  const items = built.items;
  if (record.rest === undefined) {
    return { id, path, kind: "tuple", items: Object.freeze(items), ...available() };
  }
  const rest = context.child(record.rest, freezePath([...path, "..."]));
  return rest
    ? { id, path, kind: "tuple", items: Object.freeze(items), rest, ...available() }
    : partialTupleNode(id, path, items);
}

function buildIndexedEdges(
  inputs: readonly unknown[],
  path: HostPath,
  context: NodeBuildContext,
): { readonly complete: boolean; readonly items: EditorEdge[] } {
  const items: EditorEdge[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const item = context.child(inputs[index], freezePath([...path, index]));
    if (!item) return { complete: false, items };
    items.push(item);
  }
  return { complete: true, items };
}

export function unionNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const inputs = readArray(record.variants, context.maximumCollectionSize);
  if (!inputs) return unknownNode(id, path, "invalid-shape");
  const variants: EditorEdge[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const variant = context.child(inputs[index], freezePath([...path, "$variant", index]));
    if (!variant) return partialUnionNode(id, path, variants);
    variants.push(variant);
  }
  const discriminator = optionalData(record.discriminator);
  if (discriminator === null) return unknownNode(id, path, "invalid-shape");
  return {
    id,
    path,
    kind: "union",
    variants: Object.freeze(variants),
    ...(validText(record.semantics) ? { semantics: record.semantics } : {}),
    ...(discriminator === undefined ? {} : { discriminator }),
    ...available(),
  };
}

export function unknownNode(id: string, path: HostPath, code: EditorUnknownCode): EditorNode {
  return {
    id,
    path,
    kind: "unknown",
    availability: "unknown",
    evidence: evidence(code, path),
    relations: Object.freeze([]),
  };
}

export function evidence(code: EditorUnknownCode, path: HostPath) {
  return Object.freeze([Object.freeze({ code, path })]);
}

function partialObjectNode(
  id: string,
  path: HostPath,
  properties: EditorPropertyEdge[],
): EditorNode {
  return {
    id,
    path,
    kind: "object",
    properties: Object.freeze(properties),
    requiredNames: Object.freeze([]),
    ...unavailable("edge-limit", path),
  };
}

function partialTupleNode(id: string, path: HostPath, items: EditorEdge[]): EditorNode {
  return {
    id,
    path,
    kind: "tuple",
    items: Object.freeze(items),
    ...unavailable("edge-limit", path),
  };
}

function partialUnionNode(id: string, path: HostPath, variants: EditorEdge[]): EditorNode {
  return {
    id,
    path,
    kind: "union",
    variants: Object.freeze(variants),
    ...unavailable("edge-limit", path),
  };
}

function available(): Pick<EditorNode, "availability" | "evidence" | "relations"> {
  return { availability: "available", evidence: Object.freeze([]), relations: Object.freeze([]) };
}

function unavailable(code: EditorUnknownCode, path: HostPath) {
  return {
    availability: "unknown" as const,
    evidence: evidence(code, path),
    relations: Object.freeze([]),
  };
}

function freezePath(path: HostPath): HostPath {
  return Object.freeze([...path]);
}

function readPresence(record: Record<string, unknown>) {
  if (["required", "optional", "unknown"].includes(record.presence as string)) {
    return record.presence as "required" | "optional" | "unknown";
  }
  return record.required === true ? ("required" as const) : ("optional" as const);
}

function optionalChild(
  value: unknown,
  path: HostPath,
  context: NodeBuildContext,
): EditorEdge | undefined | null {
  return value === undefined ? undefined : context.child(value, freezePath(path));
}

function optionalData(value: unknown) {
  if (value === undefined) return undefined;
  const cloned = cloneSerializableData(value);
  return cloned.ok ? cloned.value : null;
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  const items = readArray(value, 8_192);
  return items?.every((item) => typeof item === "string") ? (items as string[]) : null;
}

function validUnknownKeys(
  value: unknown,
): value is "strip" | "reject" | "passthrough" | "schema" | "unknown" {
  return ["strip", "reject", "passthrough", "schema", "unknown"].includes(value as string);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}

function relationEdges(input: unknown, path: HostPath, context: NodeBuildContext) {
  if (input === undefined) return [];
  const items = readArray(input, context.maximumCollectionSize);
  if (!items) return null;
  const output = [];
  for (let index = 0; index < items.length; index += 1) {
    const inspected = readOwnDataRecord(items[index], 4);
    if (!inspected.ok || !validText(inspected.value.name)) return null;
    const child = context.child(inspected.value.shape, freezePath([...path, "$relation", index]));
    if (!child) return null;
    const key = validText(inspected.value.key) ? inspected.value.key : undefined;
    output.push(Object.freeze({ ...child, name: inspected.value.name, ...(key ? { key } : {}) }));
  }
  return output;
}

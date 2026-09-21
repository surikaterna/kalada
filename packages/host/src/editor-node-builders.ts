import type {
  EditorEdge,
  EditorNode,
  EditorPropertyEdge,
  EditorUnknownCode,
  HostPath,
} from "./editor-types.js";
import { readArray } from "./input-readers.js";
import { readOwnDataRecord } from "./serializable.js";

export interface NodeBuildContext {
  readonly maximumCollectionSize: number;
  readonly child: (shape: unknown, path: HostPath) => EditorEdge | null;
}

export function scalarNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode {
  const names = ["null", "boolean", "number", "string", "json", "instant", "duration"];
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
  return { id, path, kind: "object", properties: Object.freeze(properties), ...available() };
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
  return child ? Object.freeze({ ...child, name, required: record.required === true }) : null;
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
  return { id, path, kind: "union", variants: Object.freeze(variants), ...available() };
}

export function unknownNode(id: string, path: HostPath, code: EditorUnknownCode): EditorNode {
  return {
    id,
    path,
    kind: "unknown",
    availability: "unknown",
    evidence: evidence(code, path),
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

function available(): Pick<EditorNode, "availability" | "evidence"> {
  return { availability: "available", evidence: Object.freeze([]) };
}

function unavailable(code: EditorUnknownCode, path: HostPath) {
  return { availability: "unknown" as const, evidence: evidence(code, path) };
}

function freezePath(path: HostPath): HostPath {
  return Object.freeze([...path]);
}

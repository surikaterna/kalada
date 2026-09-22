import type { NodeBuildContext } from "./editor-node-builders.js";
import { unknownNode } from "./editor-node-builders.js";
import type { EditorEdge, EditorNode, HostPath } from "./editor-types.js";
import { readArray } from "./input-readers.js";
import { cloneSerializableData } from "./serializable.js";

const available = Object.freeze({
  availability: "available" as const,
  evidence: Object.freeze([]),
  relations: Object.freeze([]),
});

export function evidenceNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode | null {
  if (record.kind === "literal") return dataNode("literal", "value", record, id, path);
  if (record.kind === "enum") return enumNode(record, id, path);
  if (record.kind === "never") return { id, path, kind: "never", ...available };
  if (record.kind === "unconstrained") return unconstrainedNode(record, id, path);
  if (record.kind === "opaque") return opaqueNode(record, id, path);
  return null;
}

export function compositeEvidenceNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode | null {
  if (record.kind === "record") return recordNode(record, id, path, context);
  if (record.kind === "intersection") return intersectionNode(record, id, path, context);
  if (record.kind === "wrapper") return wrapperNode(record, id, path, context);
  return null;
}

function dataNode(
  kind: "literal",
  field: "value",
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode {
  const cloned = cloneSerializableData(record[field]);
  return cloned.ok
    ? { id, path, kind, [field]: cloned.value, ...available }
    : unknownNode(id, path, "invalid-shape");
}

function enumNode(record: Record<string, unknown>, id: string, path: HostPath): EditorNode {
  const cloned = cloneSerializableData(record.values);
  if (!cloned.ok || !Array.isArray(cloned.value)) return unknownNode(id, path, "invalid-shape");
  return { id, path, kind: "enum", values: cloned.value, ...available };
}

function unconstrainedNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
): EditorNode {
  return record.domain === "json" || record.domain === "js"
    ? { id, path, kind: "unconstrained", domain: record.domain, ...available }
    : unknownNode(id, path, "invalid-shape");
}

function opaqueNode(record: Record<string, unknown>, id: string, path: HostPath): EditorNode {
  return typeof record.reason === "string"
    ? { id, path, kind: "opaque", reason: record.reason.slice(0, 256), ...available }
    : unknownNode(id, path, "invalid-shape");
}

function recordNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const key = context.child(record.key, Object.freeze([...path, "$key"]));
  const value = context.child(record.value, Object.freeze([...path, "$value"]));
  const exhaustive = record.exhaustive;
  if (!key || !value || (exhaustive !== true && exhaustive !== false && exhaustive !== "unknown")) {
    return unknownNode(id, path, "invalid-shape");
  }
  return { id, path, kind: "record", key, value, exhaustive, ...available };
}

function intersectionNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const operands = childList(record.operands, path, "$operand", context);
  return operands
    ? { id, path, kind: "intersection", operands: Object.freeze(operands), ...available }
    : unknownNode(id, path, "invalid-shape");
}

function wrapperNode(
  record: Record<string, unknown>,
  id: string,
  path: HostPath,
  context: NodeBuildContext,
): EditorNode {
  const inner = context.child(record.inner, Object.freeze([...path, "$inner"]));
  if (!inner || typeof record.wrapper !== "string") return unknownNode(id, path, "invalid-shape");
  const value = record.value === undefined ? undefined : cloneSerializableData(record.value);
  if (value && !value.ok) return unknownNode(id, path, "invalid-shape");
  return {
    id,
    path,
    kind: "wrapper",
    wrapper: record.wrapper.slice(0, 256),
    inner,
    ...(value?.ok ? { value: value.value } : {}),
    ...available,
  };
}

function childList(
  input: unknown,
  path: HostPath,
  segment: string,
  context: NodeBuildContext,
): EditorEdge[] | null {
  const items = readArray(input, context.maximumCollectionSize);
  if (!items) return null;
  const output: EditorEdge[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const child = context.child(items[index], Object.freeze([...path, segment, index]));
    if (!child) return null;
    output.push(child);
  }
  return output;
}

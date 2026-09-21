import type { ManualEditorShapeDocument } from "./editor-types.js";
import { readArray } from "./input-readers.js";
import { readOwnDataRecord } from "./serializable.js";

interface ValidationState {
  readonly seen: WeakSet<object>;
  nodes: number;
}

export function validateEditorDocument(document: ManualEditorShapeDocument): boolean {
  const state: ValidationState = { seen: new WeakSet(), nodes: 0 };
  if (!validateShape(document.root, 0, state)) return false;
  const definitions = readArray(document.definitions ?? [], 2_048);
  if (!definitions) return false;
  for (const definition of definitions) {
    const inspected = readOwnDataRecord(definition, 3);
    if (!inspected.ok || !validateShape(inspected.value.shape, 0, state)) return false;
  }
  return true;
}

function validateShape(input: unknown, depth: number, state: ValidationState): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  if (state.seen.has(input)) return true;
  state.nodes += 1;
  if (depth > 32 || state.nodes > 2_048) return true;
  state.seen.add(input);
  const inspected = readOwnDataRecord(input, 8_192);
  if (!inspected.ok) return false;
  const record = inspected.value;
  if (!validateRelations(record.relations, depth, state)) return false;
  if (record.kind === "object") return validateObject(record, depth, state);
  if (record.kind === "array") return validateShape(record.element, depth + 1, state);
  if (record.kind === "tuple") return validateTuple(record, depth, state);
  if (record.kind === "union") return validateCollection(record.variants, depth, state);
  if (record.kind === "intersection") return validateCollection(record.operands, depth, state);
  if (record.kind === "record") {
    return (
      validateShape(record.key, depth + 1, state) && validateShape(record.value, depth + 1, state)
    );
  }
  if (record.kind === "wrapper") return validateShape(record.inner, depth + 1, state);
  return true;
}

function validateObject(
  record: Record<string, unknown>,
  depth: number,
  state: ValidationState,
): boolean {
  if (!validateProperties(record.properties, depth, state)) return false;
  return (
    record.additionalProperties === undefined ||
    validateShape(record.additionalProperties, depth + 1, state)
  );
}

function validateRelations(input: unknown, depth: number, state: ValidationState): boolean {
  if (input === undefined) return true;
  const relations = readArray(input, 8_192);
  if (!relations) return false;
  for (const relation of relations) {
    const inspected = readOwnDataRecord(relation, 4);
    if (!inspected.ok || !validateShape(inspected.value.shape, depth + 1, state)) return false;
  }
  return true;
}

function validateProperties(input: unknown, depth: number, state: ValidationState): boolean {
  const properties = readArray(input, 8_192);
  if (!properties) return false;
  for (const property of properties) {
    const inspected = readOwnDataRecord(property, 4);
    if (!inspected.ok || !validateShape(inspected.value.shape, depth + 1, state)) return false;
  }
  return true;
}

function validateTuple(
  record: Record<string, unknown>,
  depth: number,
  state: ValidationState,
): boolean {
  if (!validateCollection(record.items, depth, state)) return false;
  return record.rest === undefined || validateShape(record.rest, depth + 1, state);
}

function validateCollection(input: unknown, depth: number, state: ValidationState): boolean {
  const items = readArray(input, 8_192);
  if (!items) return false;
  return items.every((item) => validateShape(item, depth + 1, state));
}

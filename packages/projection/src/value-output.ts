import {
  isDuration,
  isInstant,
  isOption,
  isResult,
  type JsonValue,
  type KaladaValue,
} from "@kalada/core/kalada-v1";
import { frozenRecord } from "./canonical-output.js";
import type { OutputEntry, OutputTree } from "./output-accounting.js";
import type { ProjectionPath } from "./types.js";

export const OMIT = Symbol("projection-omit");

export function valueOutput(value: KaladaValue, path: ProjectionPath): OutputTree | typeof OMIT {
  if (isOption(value)) {
    if (value.variant === "none") return OMIT;
    return jsonOutput(value.value, path, true);
  }
  return jsonOutput(value, path, true);
}

function jsonOutput(value: KaladaValue, path: ProjectionPath, root: boolean): OutputTree {
  if (isOption(value) || isResult(value) || isInstant(value) || isDuration(value))
    throw new TypeError();
  if (value === null || typeof value !== "object") return Object.freeze({ value, path });
  if (Array.isArray(value)) return arrayOutput(value, path, root);
  return objectOutput(value, path, root);
}

function arrayOutput(
  value: readonly KaladaValue[],
  path: ProjectionPath,
  root: boolean,
): OutputTree {
  const items = value.map((item, index) => jsonOutput(item, childPath(path, index, root), false));
  const output = Object.freeze(items.map((item) => item.value)) as JsonValue[];
  return Object.freeze({ value: output, path, items });
}

function objectOutput(
  value: Readonly<Record<string, KaladaValue>>,
  path: ProjectionPath,
  root: boolean,
): OutputTree {
  const entries = Object.keys(value).map((key) => {
    const keyPath = childPath(path, key, root);
    return Object.freeze({
      key,
      keyPath,
      output: jsonOutput(value[key] as KaladaValue, keyPath, false),
    });
  });
  return Object.freeze({ value: outputRecord(entries), path, entries });
}

function outputRecord(entries: readonly OutputEntry[]): JsonValue {
  const fields: Record<string, JsonValue> = Object.create(null);
  for (const entry of entries) fields[entry.key] = entry.output.value;
  return frozenRecord(fields) as JsonValue;
}

function childPath(path: ProjectionPath, segment: string | number, root: boolean): ProjectionPath {
  return Object.freeze(root ? [...path, "output", segment] : [...path, segment]);
}

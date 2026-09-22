import { isDuration, isInstant, isOption, isResult } from "@kalada/core";
import {
  freeze,
  guardedCall,
  inspectSafely,
  isArray,
  ownData,
  ownDataProperty,
  ownEnumerableKeys,
  prototypeOf,
  unsupported,
} from "./own.js";

const LIMITS = Object.freeze({ depth: 32, nodes: 4096, text: 256 * 1024 });
interface Context {
  readonly seen: Map<object, number>;
  nodes: number;
}

export function valueSnapshot(value: unknown): unknown {
  return inspectSafely(() => freeze(visit(value, 0, { seen: new Map(), nodes: 0 })), unsupported);
}

function visit(value: unknown, depth: number, context: Context): unknown {
  context.nodes += 1;
  if (context.nodes > LIMITS.nodes || depth > LIMITS.depth) return { type: "truncated" };
  const primitive = primitiveSnapshot(value);
  if (primitive !== NO_MATCH) return primitive;
  if (!value || typeof value !== "object") return { type: "unsupported" };
  const known = context.seen.get(value);
  if (known !== undefined) return { type: "reference", id: known };
  context.seen.set(value, context.seen.size + 1);
  if (guardedCall(() => isOption(value) || isResult(value)))
    return algebraicSnapshot(value, depth, context);
  if (guardedCall(() => isInstant(value) || isDuration(value))) {
    return { type: ownData(value, "type"), milliseconds: ownData(value, "milliseconds") };
  }
  if (isArray(value)) return arraySnapshot(value, depth, context);
  const prototype = prototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return { type: "unsupported" };
  return jsonObjectSnapshot(value, depth, context);
}

const NO_MATCH = Symbol("no-match");
function primitiveSnapshot(value: unknown): unknown | typeof NO_MATCH {
  if (value === undefined) return { type: "undefined" };
  if (typeof value === "bigint") return { type: "bigint", decimal: String(value) };
  if (typeof value === "number" && !Number.isFinite(value)) return { type: "nonfinite" };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  return NO_MATCH;
}

function algebraicSnapshot(value: object, depth: number, context: Context): unknown {
  const variant = ownData(value, "variant");
  const output: Record<string, unknown> = {
    type: ownData(value, "type"),
    variant,
  };
  if (variant !== "none") output.value = visit(ownData(value, "value"), depth + 1, context);
  return output;
}

function arraySnapshot(value: readonly unknown[], depth: number, context: Context): unknown {
  const output: unknown[] = [];
  const length = ownData(value, "length");
  if (!Number.isSafeInteger(length) || (length as number) < 0) return { type: "unsupported" };
  for (let index = 0; index < (length as number); index += 1) {
    if (context.nodes >= LIMITS.nodes) {
      output.push({ type: "truncated" });
      break;
    }
    const item = ownDataProperty(value, index);
    output.push(item.found ? visit(item.value, depth + 1, context) : { type: "unsupported" });
  }
  return output;
}

function jsonObjectSnapshot(value: object, depth: number, context: Context): unknown {
  const output: Record<string, unknown> = Object.create(null);
  for (const key of [...ownEnumerableKeys(value)].sort()) {
    if (context.nodes >= LIMITS.nodes) {
      output.__kaladaInspectorTruncated = { type: "truncated" };
      break;
    }
    const item = ownDataProperty(value, key);
    output[key] = item.found ? visit(item.value, depth + 1, context) : { type: "unsupported" };
  }
  return output;
}

export function valueJson(value: unknown): string {
  return inspectSafely(
    () => {
      const text = JSON.stringify(valueSnapshot(value), null, 2);
      if (text.length <= LIMITS.text) return text;
      return JSON.stringify({ type: "text-truncated" }, null, 2);
    },
    () => '{"type":"unsupported"}',
  );
}

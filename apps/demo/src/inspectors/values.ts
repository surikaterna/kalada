import { isDuration, isInstant, isOption, isResult } from "@kalada/core";
import { freeze, ownData } from "./own.js";

const LIMITS = Object.freeze({ depth: 32, nodes: 4096, text: 256 * 1024 });
interface Context {
  readonly seen: Map<object, number>;
  nodes: number;
}

export function valueSnapshot(value: unknown): unknown {
  return freeze(visit(value, 0, { seen: new Map(), nodes: 0 }));
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
  if (isOption(value) || isResult(value)) return algebraicSnapshot(value, depth, context);
  if (isInstant(value) || isDuration(value)) {
    return { type: ownData(value, "type"), milliseconds: ownData(value, "milliseconds") };
  }
  if (Array.isArray(value)) return arraySnapshot(value, depth, context);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    return { type: "unsupported" };
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
  for (let index = 0; index < value.length; index += 1) {
    if (context.nodes >= LIMITS.nodes) {
      output.push({ type: "truncated" });
      break;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    output.push(
      descriptor && "value" in descriptor
        ? visit(descriptor.value, depth + 1, context)
        : { type: "unsupported" },
    );
  }
  return output;
}

function jsonObjectSnapshot(value: object, depth: number, context: Context): unknown {
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (context.nodes >= LIMITS.nodes) {
      output.__kaladaInspectorTruncated = { type: "truncated" };
      break;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    output[key] =
      descriptor && "value" in descriptor
        ? visit(descriptor.value, depth + 1, context)
        : { type: "unsupported" };
  }
  return output;
}

export function valueJson(value: unknown): string {
  const text = JSON.stringify(valueSnapshot(value), null, 2);
  if (text.length <= LIMITS.text) return text;
  return JSON.stringify({ type: "text-truncated" }, null, 2);
}

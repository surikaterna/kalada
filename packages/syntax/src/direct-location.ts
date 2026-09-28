import type { KaladaType } from "@kalada/core";
import type { KaladaCstNode, KaladaSourceRange } from "./cst-types.js";
import { diagnostic, KALADA_SYNTAX_DIAGNOSTIC_MESSAGES } from "./diagnostics.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import { ownDataProperty } from "./limits.js";
import { parseKaladaV1Expression } from "./parse.js";
import type { KaladaParseOptions, KaladaSyntaxDiagnostic } from "./public-types.js";
import { readStaticType } from "./static-types.js";

/** Static evidence only; the host must authorize this target again at use time. */
export interface KaladaDataStateRef {
  readonly namespace: "data";
  readonly scope?: string;
  readonly segments: readonly string[];
}

export interface KaladaDirectLocationProperty {
  readonly type: KaladaType;
  readonly writable: true;
  readonly properties?: Readonly<Record<string, KaladaDirectLocationProperty>>;
}

export interface KaladaDirectLocationBinding extends KaladaDirectLocationProperty {
  readonly target: KaladaDataStateRef;
}

export interface KaladaDirectLocationOptions extends KaladaParseOptions {
  readonly bindings: Readonly<Record<string, KaladaDirectLocationBinding>>;
}

export interface KaladaDirectLocation {
  readonly target: KaladaDataStateRef;
  readonly type: KaladaType;
  readonly range: KaladaSourceRange;
}

export type KaladaDirectLocationOutcome =
  | { readonly ok: true; readonly location: KaladaDirectLocation }
  | { readonly ok: false; readonly diagnostics: readonly KaladaSyntaxDiagnostic[] };

type WriteCode =
  | "KALADA_SYNTAX_WRITE_INELIGIBLE"
  | "KALADA_SYNTAX_WRITE_BINDING_INVALID"
  | "KALADA_SYNTAX_WRITE_PROPERTY_INVALID";
type Field = { readonly name: string; readonly range: KaladaSourceRange };

function failure(code: WriteCode, range: KaladaSourceRange): KaladaDirectLocationOutcome {
  return deepFreeze({
    ok: false,
    diagnostics: [diagnostic("lower", code, KALADA_SYNTAX_DIAGNOSTIC_MESSAGES[code], range, [])],
  });
}

function safeKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !["__proto__", "prototype", "constructor"].includes(value)
  );
}

function record(
  input: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    const found = Reflect.ownKeys(input);
    return (
      found.every(
        (key) => typeof key === "string" && (keys.includes(key) || optional.includes(key)),
      ) &&
      keys.every((key) => ownDataProperty(input, key).present && ownDataProperty(input, key).ok) &&
      found.every((key) => ownDataProperty(input, key).ok)
    );
  } catch {
    return false;
  }
}

function target(input: unknown, max: number): KaladaDataStateRef | null {
  if (!record(input, ["namespace", "segments"], ["scope"])) return null;
  const namespace = ownDataProperty(input, "namespace").value;
  const scope = ownDataProperty(input, "scope");
  const segments = ownDataProperty(input, "segments").value;
  if (namespace !== "data" || (scope.present && !safeKey(scope.value))) return null;
  const copy = copySegments(segments, max, scope.present);
  if (copy === null) return null;
  return scope.present
    ? { namespace: "data", scope: scope.value as string, segments: copy }
    : { namespace: "data", segments: copy };
}

function copySegments(segments: unknown, max: number, scoped: boolean): string[] | null {
  if (!Array.isArray(segments)) return null;
  const copy: string[] = [];
  try {
    if (Object.getPrototypeOf(segments) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(segments);
    const length = arrayLength(segments, keys);
    if (length > max || (!scoped && length === 0)) return null;
    for (let i = 0; i < length; i++) {
      const part = ownDataProperty(segments, String(i));
      if (!part.ok || !part.present || !safeKey(part.value)) return null;
      copy.push(part.value);
    }
    if (!keys.every((key) => typeof key === "string" && arrayKey(key, length))) return null;
  } catch {
    return null;
  }
  return copy;
}

function snapshotType(input: unknown): unknown | null {
  const ancestors = new Set<object>();
  const budget = { remaining: 512 };
  try {
    return copyType(input, ancestors, budget, 0);
  } catch {
    // A malformed descriptor, cycle, depth limit, or throwing proxy is not static evidence.
    return null;
  }
}

function copyType(
  input: unknown,
  ancestors: Set<object>,
  budget: { remaining: number },
  depth: number,
): unknown {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "object") throw Error("non-data type leaf");
  if (depth >= 256 || ancestors.has(input)) throw Error("invalid type graph");
  ancestors.add(input);
  try {
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype))
      throw Error("exotic type prototype");
    const keys = Reflect.ownKeys(input);
    budget.remaining -= keys.length + 1;
    if (budget.remaining < 0) throw Error("type graph too large");
    const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    copyTypeFields(input, output, keys, array, ancestors, budget, depth);
    if (array) Object.setPrototypeOf(output, null);
    return Object.freeze(output);
  } finally {
    ancestors.delete(input);
  }
}

function copyTypeFields(
  input: object,
  output: object,
  keys: readonly PropertyKey[],
  array: boolean,
  ancestors: Set<object>,
  budget: { remaining: number },
  depth: number,
): void {
  const length = array ? arrayLength(input, keys) : 0;
  for (const key of keys) {
    if (typeof key !== "string" || (array && !arrayKey(key, length)))
      throw Error("invalid type key");
    if (array && key === "length") continue;
    copyTypeField(input, output, key, ancestors, budget, depth);
  }
}

function arrayLength(input: object, keys: readonly PropertyKey[]): number {
  const length = ownDataProperty(input, "length").value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length > 512)
    throw Error("invalid type array");
  if (keys.length !== length + 1) throw Error("sparse type array");
  return length;
}

function copyTypeField(
  input: object,
  output: object,
  key: string,
  ancestors: Set<object>,
  budget: { remaining: number },
  depth: number,
): void {
  const part = ownDataProperty(input, key);
  if (!part.ok || !part.present) throw Error("invalid type descriptor");
  Object.defineProperty(output, key, {
    value: copyType(part.value, ancestors, budget, depth + 1),
    enumerable: true,
    configurable: true,
  });
}

function arrayKey(key: string, length: number): boolean {
  if (key === "length") return true;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function property(
  input: unknown,
  binding: boolean,
  max: number,
): { type: KaladaType; properties?: unknown } | null {
  if (
    !record(input, binding ? ["target", "type", "writable"] : ["type", "writable"], ["properties"])
  )
    return null;
  if (ownDataProperty(input, "writable").value !== true) return null;
  const snapshot = snapshotType(ownDataProperty(input, "type").value);
  if (snapshot === null) return null;
  const type = readStaticType(snapshot, max);
  if (type === null || type === "dynamic" || "shape" in type) return null;
  const properties = ownDataProperty(input, "properties");
  if (
    properties.present &&
    (type.kind !== "primitive-type" ||
      type.name !== "json" ||
      typeof properties.value !== "object" ||
      properties.value === null ||
      Array.isArray(properties.value))
  )
    return null;
  return { type, properties: properties.value };
}

function chain(
  node: KaladaCstNode,
  max: number,
): { reference: string; fields: Field[]; range: KaladaSourceRange } | null {
  const fields: Field[] = [];
  const range = node.range;
  let current = node;
  for (let depth = 0; depth <= max; depth++) {
    if (current.kind === "group" && current.closeToken !== null) {
      current = current.expression;
      continue;
    }
    if (current.kind === "reference")
      return { reference: current.name, fields: fields.reverse(), range };
    if (
      current.kind !== "field-access" ||
      current.optional ||
      current.fieldToken === null ||
      !safeKey(current.field)
    )
      return null;
    fields.push({ name: current.field, range: current.range });
    current = current.target;
  }
  return null;
}

export function checkKaladaV1DirectLocation(
  source: string,
  options: KaladaDirectLocationOptions,
): KaladaDirectLocationOutcome {
  try {
    return checkSource(source, options);
  } catch {
    return failure(
      "KALADA_SYNTAX_WRITE_BINDING_INVALID",
      freezeRange(0, typeof source === "string" ? source.length : 0),
    );
  }
}

function checkSource(
  source: string,
  options: KaladaDirectLocationOptions,
): KaladaDirectLocationOutcome {
  // Reparse source: never accept a caller-supplied CST or a read-context lowered program.
  const limits = ownDataProperty(options, "limits");
  const bindings = ownDataProperty(options, "bindings");
  if (!record(options, ["bindings"], ["limits"]) || !bindings.ok || !bindings.present || !limits.ok)
    return failure(
      "KALADA_SYNTAX_WRITE_BINDING_INVALID",
      freezeRange(0, typeof source === "string" ? source.length : 0),
    );
  const parsed = parseKaladaV1Expression(
    source,
    limits.present ? { limits: limits.value as KaladaParseOptions["limits"] } : undefined,
  );
  if (parsed.diagnostics.length) return deepFreeze({ ok: false, diagnostics: parsed.diagnostics });
  const range = parsed.document.expression.range;
  const found = chain(parsed.document.expression, 256);
  if (!found) return failure("KALADA_SYNTAX_WRITE_INELIGIBLE", range);
  return resolveLocation(found, bindings.value);
}

function resolveLocation(
  found: NonNullable<ReturnType<typeof chain>>,
  bindings: unknown,
): KaladaDirectLocationOutcome {
  const range = found.range;
  const binding = ownDataProperty(bindings, found.reference);
  if (!binding.ok || !binding.present) return failure("KALADA_SYNTAX_WRITE_BINDING_INVALID", range);
  let entry = property(binding.value, true, 256);
  const base = target(ownDataProperty(binding.value, "target").value, 256);
  if (!entry || !base || !safeKey(found.reference))
    return failure("KALADA_SYNTAX_WRITE_BINDING_INVALID", range);
  const segments = [...base.segments];
  for (const field of found.fields) {
    const next = ownDataProperty(entry.properties, field.name);
    if (!next.ok || !next.present)
      return failure("KALADA_SYNTAX_WRITE_PROPERTY_INVALID", field.range);
    entry = property(next.value, false, 256);
    if (!entry) return failure("KALADA_SYNTAX_WRITE_PROPERTY_INVALID", field.range);
    segments.push(field.name);
  }
  return deepFreeze({
    ok: true,
    location: {
      target: { ...base, segments },
      type: entry.type,
      range: freezeRange(range.start, range.end),
    },
  });
}

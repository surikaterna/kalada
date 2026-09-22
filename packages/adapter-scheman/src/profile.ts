import { readSemanticType, type SemanticTypeResult } from "@kalada/host";
import type { SchemaNode } from "@scheman/core";
import type { AdaptSchemanOptions, KaladaLossPolicy, SchemanAdapterDiagnostic } from "./types.js";

type SemanticType = Extract<SemanticTypeResult, { ok: true }>["value"];
export interface ResolvedProfile {
  readonly type: SemanticType;
  readonly codec?: string;
  readonly lossy?: KaladaLossPolicy;
  readonly source: "override" | "x-kalada" | "conservative";
  readonly finalValidation: "kalada-type" | "safe-integer-and-kalada-type";
}

type ProfileResult =
  | Readonly<{ ok: true; value: ResolvedProfile }>
  | Readonly<{ ok: false; diagnostics: readonly SchemanAdapterDiagnostic[] }>;
type OptionalProfileResult =
  | Readonly<{ ok: true; value?: ResolvedProfile }>
  | Readonly<{ ok: false; diagnostics: readonly SchemanAdapterDiagnostic[] }>;

export function resolveProfile(
  options: AdaptSchemanOptions,
  conservative: SemanticType,
): ProfileResult {
  try {
    return resolveProfileSafely(options, conservative);
  } catch {
    return failed("SCHEMAN_ADAPTER_PROFILE_MALFORMED", "<unavailable>");
  }
}

function resolveProfileSafely(
  options: AdaptSchemanOptions,
  conservative: SemanticType,
): ProfileResult {
  const nodeId = options.document.root.output.nodeId;
  const node = options.document.nodes[nodeId];
  if (!node) return failed("SCHEMAN_ADAPTER_UNRESOLVED_ROOT", nodeId);
  const local = readNodeProfile(node, nodeId);
  if (!local.ok) return local;
  const override = options.binding.override
    ? readPayload(options.binding.override, false, nodeId)
    : Object.freeze({ ok: true as const, value: undefined });
  if (!override.ok) return override;
  const selected = override.value ?? local.value;
  const source = override.value ? "override" : local.value ? "x-kalada" : "conservative";
  if (!selected) return success({ type: conservative, source, finalValidation: "kalada-type" });
  const compatibility = checkCompatibility(selected, conservative, node, options, nodeId);
  if (!compatibility.ok) return compatibility;
  return success({
    ...selected,
    source,
    finalValidation:
      selected.lossy === "safe-integer-bigint-to-number"
        ? "safe-integer-and-kalada-type"
        : "kalada-type",
  });
}

function readNodeProfile(node: SchemaNode, nodeId: string): OptionalProfileResult {
  const metadata = optionalRecord(node.metadata);
  const constraints = optionalRecord(node.constraints);
  if (!metadata.ok || !constraints.ok) return failed("SCHEMAN_ADAPTER_PROFILE_MALFORMED", nodeId);
  const direct = ownSlot(metadata.value, "x-kalada");
  const extensions = nestedRecord(metadata.value, "extensions");
  const annotations = nestedRecord(metadata.value, "annotations");
  if (!extensions.ok || !annotations.ok) return failed("SCHEMAN_ADAPTER_PROFILE_MALFORMED", nodeId);
  const extension = ownSlot(extensions.value, "x-kalada");
  const annotation = ownSlot(annotations.value, "x-kalada");
  const constrained = ownSlot(constraints.value, "x-kalada");
  if (annotation.present || constrained.present || (direct.present && extension.present)) {
    return failed("SCHEMAN_ADAPTER_PROFILE_CONFLICT", nodeId);
  }
  const payload = direct.present ? direct : extension;
  if (!payload.present) return Object.freeze({ ok: true });
  return readPayload(payload.value, true, nodeId);
}

function readPayload(input: unknown, versioned: boolean, nodeId: string): ProfileResult {
  const inspected = ownRecord(input);
  const allowed = versioned ? ["version", "type", "codec", "lossy"] : ["type", "codec", "lossy"];
  if (!inspected.ok) return failed("SCHEMAN_ADAPTER_PROFILE_MALFORMED", nodeId);
  const record = inspected.value;
  if (!exactAllowedKeys(inspected, allowed) || (versioned && record.version !== 1)) {
    return failed("SCHEMAN_ADAPTER_PROFILE_MALFORMED", nodeId);
  }
  const type = readSemanticType(record.type);
  const codec = readBoundedText(record.codec);
  const lossy = readLossPolicy(record.lossy);
  if (!type.ok || codec === null || lossy === null) {
    return failed("SCHEMAN_ADAPTER_PROFILE_MALFORMED", nodeId);
  }
  return success({
    type: type.value,
    ...(codec ? { codec } : {}),
    ...(lossy ? { lossy } : {}),
    source: versioned ? "x-kalada" : "override",
    finalValidation: "kalada-type",
  });
}

function checkCompatibility(
  profile: ResolvedProfile,
  conservative: SemanticType,
  node: SchemaNode,
  options: AdaptSchemanOptions,
  nodeId: string,
): ProfileResult {
  const conversion = !sameType(profile.type, conservative) || profile.lossy !== undefined;
  if (conversion && !profile.codec) return failed("SCHEMAN_ADAPTER_CODEC_REQUIRED", nodeId);
  if (profile.lossy && !validLossPolicy(profile, node)) {
    return failed("SCHEMAN_ADAPTER_PROFILE_INCOMPATIBLE", nodeId);
  }
  if (profile.codec && !matchingCodec(profile.codec, options)) {
    return failed("SCHEMAN_ADAPTER_CODEC_MISMATCH", nodeId);
  }
  return success(profile);
}

function validLossPolicy(profile: ResolvedProfile, node: SchemaNode): boolean {
  if (profile.lossy === "safe-integer-bigint-to-number") {
    return (
      node.kind === "primitive" && node.type === "bigint" && isPrimitive(profile.type, "number")
    );
  }
  if (profile.lossy === "heterogeneous-union-to-json") {
    return node.kind === "union" && isPrimitive(profile.type, "json");
  }
  return true;
}

function matchingCodec(id: string, options: AdaptSchemanOptions): boolean {
  const codec = options.codec;
  return Boolean(
    codec &&
      codec.id === id &&
      codec.mode === options.mode &&
      codec.capabilityVersion.length > 0 &&
      codec.configurationDigest.length > 0,
  );
}

function isPrimitive(type: SemanticType, name: string): boolean {
  return type !== "dynamic" && type.kind === "primitive-type" && type.name === name;
}

function sameType(left: SemanticType, right: SemanticType): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readBoundedText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

function readLossPolicy(value: unknown): KaladaLossPolicy | undefined | null {
  if (value === undefined) return undefined;
  return value === "safe-integer-bigint-to-number" || value === "heterogeneous-union-to-json"
    ? value
    : null;
}

function exactAllowedKeys(record: OwnRecord, allowed: readonly string[]): boolean {
  return record.keys.includes("type") && record.keys.every((key) => allowed.includes(key));
}

interface OwnRecord {
  readonly ok: true;
  readonly value: Record<string, unknown>;
  readonly keys: readonly string[];
}

type OwnRecordResult = OwnRecord | Readonly<{ ok: false }>;
type OptionalRecordResult = Readonly<{ ok: true; value?: OwnRecord }> | Readonly<{ ok: false }>;
type OwnSlot = Readonly<{ present: false }> | Readonly<{ present: true; value: unknown }>;

function ownRecord(input: unknown): OwnRecordResult {
  if (typeof input !== "object" || input === null) return Object.freeze({ ok: false });
  const reflected = reflectRecord(input);
  if (!reflected) return Object.freeze({ ok: false });
  const output: Record<string, unknown> = Object.create(null);
  for (const key of reflected.keys) output[key] = reflected.descriptors[key]?.value;
  return Object.freeze({
    ok: true,
    value: Object.freeze(output),
    keys: Object.freeze(reflected.keys),
  });
}

function reflectRecord(input: object) {
  try {
    if (Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")) return null;
    const keys = ownKeys as string[];
    const descriptors: Record<string, PropertyDescriptor> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) return null;
      descriptors[key] = descriptor;
    }
    return { keys, descriptors };
  } catch {
    return null;
  }
}

function optionalRecord(input: unknown): OptionalRecordResult {
  if (input === undefined || isProfileFreeOwnedValue(input)) return Object.freeze({ ok: true });
  const record = ownRecord(input);
  return record.ok ? Object.freeze({ ok: true, value: record }) : Object.freeze({ ok: false });
}

function isProfileFreeOwnedValue(input: unknown): boolean {
  if (input === null || typeof input === "string" || typeof input === "boolean") return true;
  if (typeof input === "number") return Number.isFinite(input);
  return Array.isArray(input);
}

function nestedRecord(parent: OwnRecord | undefined, key: string): OptionalRecordResult {
  const slot = ownSlot(parent, key);
  return slot.present ? optionalRecord(slot.value) : Object.freeze({ ok: true });
}

function ownSlot(record: OwnRecord | undefined, key: string): OwnSlot {
  if (!record?.keys.includes(key)) return Object.freeze({ present: false });
  return Object.freeze({ present: true, value: record.value[key] });
}

function success(value: ResolvedProfile): ProfileResult {
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}

function failed(code: SchemanAdapterDiagnostic["code"], nodeId: string): ProfileResult {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([
      Object.freeze({ code, severity: "error", side: "output", sourcePointer: "", nodeId }),
    ]),
  });
}

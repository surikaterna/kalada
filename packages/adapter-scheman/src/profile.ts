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
  const metadata = ownRecord(node.metadata);
  const constraints = ownRecord(node.constraints);
  const direct = metadata ? ownValue(metadata, "x-kalada") : undefined;
  const extensions = metadata ? ownRecord(ownValue(metadata, "extensions")) : null;
  const extension = extensions ? ownValue(extensions, "x-kalada") : undefined;
  const annotations = metadata ? ownRecord(ownValue(metadata, "annotations")) : null;
  const misplaced = Boolean(
    (annotations && ownValue(annotations, "x-kalada") !== undefined) ||
      (constraints && ownValue(constraints, "x-kalada") !== undefined),
  );
  if (misplaced || (direct !== undefined && extension !== undefined)) {
    return failed("SCHEMAN_ADAPTER_PROFILE_CONFLICT", nodeId);
  }
  const payload = direct ?? extension;
  if (payload === undefined) return Object.freeze({ ok: true });
  return readPayload(payload, true, nodeId);
}

function readPayload(input: unknown, versioned: boolean, nodeId: string): ProfileResult {
  const record = ownRecord(input);
  const allowed = versioned ? ["version", "type", "codec", "lossy"] : ["type", "codec", "lossy"];
  if (!record || !exactAllowedKeys(record, allowed) || (versioned && record.version !== 1)) {
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

function exactAllowedKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.includes("type") && keys.every((key) => allowed.includes(key));
}

function ownRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length > 0) return null;
  if (Object.values(descriptors).some((item) => !("value" in item))) return null;
  return Object.fromEntries(Object.entries(descriptors).map(([key, item]) => [key, item.value]));
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
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

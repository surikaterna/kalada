import type {
  CapabilityMode,
  DescribeEnvironmentResult,
  ProviderIdentityInput,
} from "@kalada/host";
import type { Diagnostic, SchemaDocument, Side, StandardSchemaV1 } from "@scheman/core";

export type KaladaLossPolicy = "safe-integer-bigint-to-number" | "heterogeneous-union-to-json";

export interface KaladaProfile {
  readonly version: 1;
  readonly type: unknown;
  readonly codec?: string;
  readonly lossy?: KaladaLossPolicy;
}

export interface SchemanBindingOptions {
  readonly id: string;
  readonly name: string;
  readonly path: readonly string[];
  readonly override?: Omit<KaladaProfile, "version">;
}

export interface SchemanValidatorOptions {
  readonly validator: StandardSchemaV1;
  readonly mode: CapabilityMode;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly configurationDigest: string;
  readonly cacheable: boolean;
}

export interface SchemanCodecOptions {
  readonly id: string;
  readonly mode: CapabilityMode;
  readonly capabilityVersion: string;
  readonly configurationDigest: string;
  readonly cacheable: boolean;
  readonly convert: (value: unknown) => unknown;
}

export interface AdaptSchemanOptions extends ProviderIdentityInput {
  readonly document: SchemaDocument;
  readonly mode: CapabilityMode;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly configurationDigest: string;
  readonly cacheable: boolean;
  readonly binding: SchemanBindingOptions;
  readonly validator?: SchemanValidatorOptions;
  readonly codec?: SchemanCodecOptions;
}

export type SchemanAdapterDiagnosticCode =
  | "SCHEMAN_ADAPTER_FORMAT_VERSION"
  | "SCHEMAN_ADAPTER_INVALID_DOCUMENT"
  | "SCHEMAN_ADAPTER_UNRESOLVED_ROOT"
  | "SCHEMAN_ADAPTER_DYNAMIC_PROJECTION"
  | "SCHEMAN_ADAPTER_PROFILE_MALFORMED"
  | "SCHEMAN_ADAPTER_PROFILE_CONFLICT"
  | "SCHEMAN_ADAPTER_PROFILE_INCOMPATIBLE"
  | "SCHEMAN_ADAPTER_CODEC_REQUIRED"
  | "SCHEMAN_ADAPTER_CODEC_MISMATCH"
  | "SCHEMAN_ADAPTER_UNSUPPORTED_EVIDENCE";

export interface SchemanAdapterDiagnostic {
  readonly code: SchemanAdapterDiagnosticCode;
  readonly severity: "warning" | "error";
  readonly side: Side;
  readonly sourcePointer: string;
  readonly nodeId?: string;
}

export interface SchemanSourceDiagnostic extends Diagnostic {
  readonly provenance: Readonly<{
    readonly providerId: "@scheman/core";
    readonly formatVersion: "1";
  }>;
}

export type AdaptSchemanResult =
  | Readonly<{
      ok: true;
      environment: Extract<DescribeEnvironmentResult, { ok: true }>["environment"];
      capabilitySnapshot: Extract<DescribeEnvironmentResult, { ok: true }>["capabilitySnapshot"];
      diagnostics: readonly (SchemanAdapterDiagnostic | SchemanSourceDiagnostic)[];
      retainedValidator?: StandardSchemaV1;
    }>
  | Readonly<{
      ok: false;
      diagnostics: readonly SchemanAdapterDiagnostic[];
    }>;

export interface SemanticMappingRule {
  readonly scheman: string;
  readonly projection: string;
  readonly condition: string;
}

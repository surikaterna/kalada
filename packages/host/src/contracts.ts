import type { KaladaSyntaxStaticType } from "@kalada/syntax";
import type { EditorGraph, HostPath, ManualEditorShapeDocument } from "./editor-types.js";

export type SerializablePrimitive = null | boolean | number | string;
export type SerializableValue =
  | SerializablePrimitive
  | readonly SerializableValue[]
  | { readonly [key: string]: SerializableValue };

export type CapabilityMode = "sync" | "async";
export type CapabilityKind = "validator" | "codec";

export interface ProviderIdentityInput {
  readonly providerId?: string;
  readonly providerVersion?: string;
  readonly configurationDigest?: string;
  readonly cacheable?: boolean;
}

export interface CapabilityIdentityInput {
  readonly capabilityId?: string;
  readonly capabilityVersion?: string;
  readonly configurationDigest?: string;
  readonly cacheable?: boolean;
}

export type Cacheability =
  | Readonly<{
      cacheable: true;
      id: string;
      version: string;
      configurationDigest: string;
    }>
  | Readonly<{
      cacheable: false;
      reason:
        | "explicitly-disabled"
        | "missing-identity"
        | "provider-not-cacheable"
        | "capability-not-cacheable";
    }>;

export interface ManualValidatorCapability extends CapabilityIdentityInput {
  readonly handle: string;
  readonly kind: "validator";
  readonly mode: CapabilityMode;
  readonly decode: (value: unknown) => unknown;
}

export interface ManualCodecCapability extends CapabilityIdentityInput {
  readonly handle: string;
  readonly kind: "codec";
  readonly mode: CapabilityMode;
  readonly convert: (value: unknown) => unknown;
}

export type ManualCapability = ManualValidatorCapability | ManualCodecCapability;

export interface CapabilityDeclaration {
  readonly handle: string;
  readonly kind: CapabilityKind;
  readonly mode: CapabilityMode;
  readonly capabilityId?: string;
  readonly capabilityVersion?: string;
  readonly configurationDigest?: string;
  readonly identity: Cacheability;
}

export type LiveCapability =
  | Readonly<
      CapabilityDeclaration & {
        readonly kind: "validator";
        readonly decode: (value: unknown) => unknown;
      }
    >
  | Readonly<
      CapabilityDeclaration & {
        readonly kind: "codec";
        readonly convert: (value: unknown) => unknown;
      }
    >;

export interface CapabilitySnapshot {
  readonly scope: "instance";
  readonly capabilities: Readonly<Record<string, LiveCapability>>;
}

export interface ProvenanceEntry {
  readonly providerId: string;
  readonly providerVersion?: string;
  readonly source?: string;
  readonly extractor?: string;
  readonly override?: string;
}

export interface ManualBindingDescriptor {
  readonly id: string;
  readonly name: string;
  readonly path: readonly string[];
  readonly semanticType: KaladaSyntaxStaticType;
  readonly editorShape?: ManualEditorShapeDocument;
  readonly validatorHandle?: string;
  readonly codecHandle?: string;
  readonly metadata?: SerializableValue;
  readonly provenance?: readonly ProvenanceEntry[];
}

export interface ManualProviderInput extends ProviderIdentityInput {
  readonly mode: CapabilityMode;
  readonly bindings: readonly ManualBindingDescriptor[];
  readonly capabilities?: readonly ManualCapability[];
}

export interface NormalizedBinding {
  readonly id: string;
  readonly name: string;
  readonly path: readonly string[];
  readonly semanticType: KaladaSyntaxStaticType;
  readonly editorShapeRoot?: string;
  readonly validator?: CapabilityDeclaration;
  readonly codec?: CapabilityDeclaration;
  readonly metadata?: SerializableValue;
  readonly provenance: readonly ProvenanceEntry[];
}

export interface NormalizedEnvironment {
  readonly format: "kalada-host-environment-v1";
  readonly provider: Readonly<{
    mode: CapabilityMode;
    providerId?: string;
    providerVersion?: string;
    configurationDigest?: string;
    identity: Cacheability;
  }>;
  readonly cacheability: Cacheability;
  readonly bindings: readonly NormalizedBinding[];
  readonly capabilities: readonly CapabilityDeclaration[];
  readonly editorGraph: EditorGraph;
}

export type HostEnvironmentDiagnosticCode =
  | "HOST_ENVIRONMENT_INVALID_PROVIDER"
  | "HOST_ENVIRONMENT_INVALID_IDENTITY"
  | "HOST_ENVIRONMENT_INVALID_CAPABILITY"
  | "HOST_ENVIRONMENT_DUPLICATE_CAPABILITY"
  | "HOST_ENVIRONMENT_INVALID_BINDING"
  | "HOST_ENVIRONMENT_DUPLICATE_BINDING"
  | "HOST_ENVIRONMENT_INVALID_SEMANTIC_TYPE"
  | "HOST_ENVIRONMENT_INVALID_METADATA"
  | "HOST_ENVIRONMENT_INVALID_PROVENANCE"
  | "HOST_ENVIRONMENT_UNKNOWN_CAPABILITY";

export interface HostDiagnostic {
  readonly code: HostEnvironmentDiagnosticCode;
  readonly phase: "environment";
  readonly message: string;
  readonly bindingPath?: HostPath;
  readonly provenance?: Readonly<Record<string, string>>;
}

export type DescribeEnvironmentResult =
  | Readonly<{
      ok: true;
      environment: NormalizedEnvironment;
      capabilitySnapshot: CapabilitySnapshot;
    }>
  | Readonly<{ ok: false; diagnostics: readonly HostDiagnostic[] }>;

export interface ManualProvider {
  readonly kind: "manual";
  readonly describe: () => DescribeEnvironmentResult;
}

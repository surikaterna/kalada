import type { KaladaV1Diagnostic } from "@kalada/core";
import type { KaladaSyntaxDiagnostic, KaladaSyntaxStaticType } from "@kalada/syntax";
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

export interface HostCompileBinding {
  readonly id: string;
  readonly name: string;
  readonly semanticType: KaladaSyntaxStaticType;
}

export interface HostCompileProjection {
  readonly format: "kalada-host-compile-projection-v1";
  readonly bindings: readonly HostCompileBinding[];
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
  readonly compileProjection: HostCompileProjection;
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

export type HostDiagnosticPhase =
  | "environment"
  | "parse"
  | "lower"
  | "compile"
  | "link"
  | "bind"
  | "evaluate";

export interface Utf16Position {
  readonly line: number;
  readonly character: number;
}

export interface Utf16Range {
  readonly start: Utf16Position;
  readonly end: Utf16Position;
}

export interface HostDiagnosticSource {
  readonly uri: string;
  readonly range: Utf16Range;
}

export type HostDiagnosticCause = Readonly<KaladaSyntaxDiagnostic | KaladaV1Diagnostic>;

export interface HostDiagnostic {
  readonly code: string;
  readonly phase: HostDiagnosticPhase;
  readonly message: string;
  readonly source?: HostDiagnosticSource;
  readonly bindingPath?: HostPath;
  readonly provenance?: Readonly<Record<string, string>>;
  readonly cause?: HostDiagnosticCause;
}

export interface HostEnvironmentDiagnostic extends HostDiagnostic {
  readonly code: HostEnvironmentDiagnosticCode;
  readonly phase: "environment";
}

export type DescribeEnvironmentResult =
  | Readonly<{
      ok: true;
      environment: NormalizedEnvironment;
      capabilitySnapshot: CapabilitySnapshot;
    }>
  | Readonly<{ ok: false; diagnostics: readonly HostEnvironmentDiagnostic[] }>;

export interface ManualProvider {
  readonly kind: "manual";
  readonly describe: () => DescribeEnvironmentResult;
}

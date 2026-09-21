import {
  createManualProvider,
  describeEnvironment,
  type ManualCapability,
  type SerializableValue,
} from "@kalada/host";
import type { Diagnostic, SchemaDocument, StandardSchemaV1 } from "@scheman/core";
import { schemanEditorDocument } from "./editor-document.js";
import { type ResolvedProfile, resolveProfile } from "./profile.js";
import { projectOutput } from "./semantic-mapping.js";
import type {
  AdaptSchemanOptions,
  AdaptSchemanResult,
  SchemanAdapterDiagnostic,
  SchemanSourceDiagnostic,
} from "./types.js";

const validatorHandle = "scheman-validator";
const codecHandle = "scheman-codec";

export function adaptSchemanDocument(options: AdaptSchemanOptions): AdaptSchemanResult {
  const document = options.document as SchemaDocument & { readonly formatVersion: number };
  const invalid = validateDocument(document);
  if (invalid) return failure(invalid);
  const projection = projectOutput(document);
  const profile = resolveProfile(options, projection.type);
  if (!profile.ok) return Object.freeze({ ok: false, diagnostics: profile.diagnostics });
  const capabilities = configuredCapabilities(options);
  const described = describeEnvironment(
    createManualProvider({
      mode: options.mode,
      providerId: options.providerId,
      providerVersion: options.providerVersion,
      configurationDigest: options.configurationDigest,
      cacheable: options.cacheable,
      capabilities,
      bindings: [
        {
          id: options.binding.id,
          name: options.binding.name,
          path: options.binding.path,
          semanticType: profile.value.type,
          editorShape: schemanEditorDocument(document),
          ...(options.validator ? { validatorHandle } : {}),
          ...(profile.value.codec ? { codecHandle } : {}),
          metadata: environmentMetadata(document, profile.value),
          provenance: [schemanProvenance(document)],
        },
      ],
    }),
  );
  if (!described.ok) return failure(adapterFailure("SCHEMAN_ADAPTER_INVALID_DOCUMENT"));
  return Object.freeze({
    ok: true,
    environment: described.environment,
    capabilitySnapshot: described.capabilitySnapshot,
    diagnostics: Object.freeze([...sourceDiagnostics(document), ...projection.diagnostics]),
    ...(options.validator ? { retainedValidator: options.validator.validator } : {}),
  });
}

function validateDocument(document: SchemaDocument & { readonly formatVersion: number }) {
  if (document.formatVersion !== 1) return adapterFailure("SCHEMAN_ADAPTER_FORMAT_VERSION");
  if (!document.root?.input?.nodeId || !document.root?.output?.nodeId) {
    return adapterFailure("SCHEMAN_ADAPTER_INVALID_DOCUMENT");
  }
  if (!document.nodes[document.root.input.nodeId] || !document.nodes[document.root.output.nodeId]) {
    return adapterFailure("SCHEMAN_ADAPTER_UNRESOLVED_ROOT");
  }
  return undefined;
}

function configuredCapabilities(options: AdaptSchemanOptions): ManualCapability[] {
  const capabilities: ManualCapability[] = [];
  if (options.validator) capabilities.push(validatorCapability(options.validator));
  if (options.codec) {
    capabilities.push({
      handle: codecHandle,
      kind: "codec",
      mode: options.codec.mode,
      capabilityId: options.codec.id,
      capabilityVersion: options.codec.capabilityVersion,
      configurationDigest: options.codec.configurationDigest,
      cacheable: options.codec.cacheable,
      convert: options.codec.convert,
    });
  }
  return capabilities;
}

function validatorCapability(config: NonNullable<AdaptSchemanOptions["validator"]>) {
  return {
    handle: validatorHandle,
    kind: "validator" as const,
    mode: config.mode,
    capabilityId: config.capabilityId,
    capabilityVersion: config.capabilityVersion,
    configurationDigest: config.configurationDigest,
    cacheable: config.cacheable,
    decode: (value: unknown) => liveValidate(config.validator, value),
  };
}

function liveValidate(validator: StandardSchemaV1, value: unknown): unknown {
  return validator["~standard"].validate(value);
}

function environmentMetadata(
  document: SchemaDocument,
  profile: ResolvedProfile,
): SerializableValue {
  return {
    scheman: {
      formatVersion: document.formatVersion,
      nodeIdScope: "document-local",
      roots: { input: document.root.input.nodeId, output: document.root.output.nodeId },
      capabilities: document.capabilities,
      definitions: document.definitions,
      diagnostics: document.diagnostics,
      metadata: document.metadata,
    },
    policy: profile,
  } as unknown as SerializableValue;
}

function schemanProvenance(document: SchemaDocument) {
  const metadata = document.metadata as { readonly provider?: unknown };
  return Object.freeze({
    providerId: "@scheman/core",
    providerVersion: "2.0.0",
    ...(typeof metadata.provider === "string" ? { extractor: metadata.provider } : {}),
  });
}

function sourceDiagnostics(document: SchemaDocument): SchemanSourceDiagnostic[] {
  return document.diagnostics.map((diagnostic) => wrapSourceDiagnostic(diagnostic));
}

function wrapSourceDiagnostic(diagnostic: Diagnostic): SchemanSourceDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    severity: diagnostic.severity,
    side: diagnostic.side,
    sourcePointer: diagnostic.sourcePointer,
    ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
    provenance: Object.freeze({ providerId: "@scheman/core", formatVersion: "1" }),
  });
}

function adapterFailure(code: SchemanAdapterDiagnostic["code"]): SchemanAdapterDiagnostic {
  return Object.freeze({ code, severity: "error", side: "output", sourcePointer: "" });
}

function failure(diagnostic: SchemanAdapterDiagnostic): AdaptSchemanResult {
  return Object.freeze({ ok: false, diagnostics: Object.freeze([diagnostic]) });
}

import {
  createManualProvider,
  describeEnvironment,
  type ManualCapability,
  type SerializableValue,
} from "@kalada/host";
import type { Diagnostic, SchemaDocument, StandardSchemaV1 } from "@scheman/core";
import { resolveAnalysisLimits } from "./analysis-limits.js";
import { schemanEditorDocument } from "./editor-document.js";
import { validNormalizedEditorGraph } from "./editor-invariants.js";
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
const maximumSourceRecords = 512;

export function adaptSchemanDocument(options: AdaptSchemanOptions): AdaptSchemanResult {
  const document = options.document as SchemaDocument & { readonly formatVersion: number };
  const invalid = validateDocument(document);
  if (invalid) return failure(invalid);
  const limits = resolveAnalysisLimits(options.analysisLimits);
  const projection = projectOutput(document, limits);
  const profile = resolveProfile(options, projection.type);
  if (!profile.ok) return Object.freeze({ ok: false, diagnostics: profile.diagnostics });
  const editor = schemanEditorDocument(document, limits);
  const sourceEvidence = boundedSourceEvidence(
    document,
    Math.min(limits.maxNodes, maximumSourceRecords),
  );
  const described = describeEnvironment(
    adapterProvider(options, document, profile.value, limits, editor, sourceEvidence),
  );
  if (!described.ok) return failure(adapterFailure("SCHEMAN_ADAPTER_INVALID_DOCUMENT"));
  if (
    !validNormalizedEditorGraph(
      described.environment.editorGraph,
      options.binding.id,
      document.root.input.nodeId,
    )
  ) {
    return failure(adapterFailure("SCHEMAN_ADAPTER_INVALID_DOCUMENT"));
  }
  return Object.freeze({
    ok: true,
    environment: described.environment,
    capabilitySnapshot: described.capabilitySnapshot,
    diagnostics: Object.freeze([
      ...sourceDiagnostics(sourceEvidence.diagnostics.values),
      ...projection.diagnostics,
      ...sourceLimitDiagnostics(sourceEvidence, editor),
    ]),
    ...(options.validator ? { retainedValidator: options.validator.validator } : {}),
  });
}

function adapterProvider(
  options: AdaptSchemanOptions,
  document: SchemaDocument,
  profile: ResolvedProfile,
  limits: ReturnType<typeof resolveAnalysisLimits>,
  editor: ReturnType<typeof schemanEditorDocument>,
  sourceEvidence: SourceEvidence,
) {
  return createManualProvider({
    mode: options.mode,
    providerId: options.providerId,
    providerVersion: options.providerVersion,
    configurationDigest: options.configurationDigest,
    cacheable: options.cacheable,
    capabilities: configuredCapabilities(options),
    bindings: [
      {
        id: options.binding.id,
        name: options.binding.name,
        path: options.binding.path,
        semanticType: profile.type,
        editorShape: editor.document,
        ...(options.validator ? { validatorHandle } : {}),
        ...(profile.codec ? { codecHandle } : {}),
        metadata: environmentMetadata(document, profile, limits, editor, sourceEvidence),
        provenance: [schemanProvenance(document)],
      },
    ],
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
  limits: ReturnType<typeof resolveAnalysisLimits>,
  editor: ReturnType<typeof schemanEditorDocument>,
  sourceEvidence: SourceEvidence,
): SerializableValue {
  const sourceRetention = sourceRetentionMetadata(document, editor, sourceEvidence);
  return {
    scheman: {
      formatVersion: document.formatVersion,
      nodeIdScope: "document-local",
      roots: { input: document.root.input.nodeId, output: document.root.output.nodeId },
      capabilities: document.capabilities,
      definitions: sourceEvidence.definitions.values,
      diagnostics: sourceEvidence.diagnostics.values,
      metadata: document.metadata,
      bounded: {
        limits,
        retainedNodes: editor.retainedNodes,
        retainedEdges: editor.retainedEdges,
        nodes: {
          retained: editor.retainedNodes,
          total: Object.keys(document.nodes).length,
          truncated: editor.nodeTruncated,
        },
        edges: editor.sourceEdges,
        requiredNames: editor.requiredNames,
        definitions: sourceEvidence.definitions.summary,
        diagnostics: sourceEvidence.diagnostics.summary,
        sourceRetention,
        hostAdmissionPlan: editor.admission,
        truncated:
          editor.nodeTruncated ||
          editor.edgeTruncated ||
          editor.requiredNames.truncated ||
          sourceEvidence.definitions.summary.truncated ||
          sourceEvidence.diagnostics.summary.truncated,
      },
    },
    policy: profile,
  } as unknown as SerializableValue;
}

function sourceRetentionMetadata(
  document: SchemaDocument,
  editor: ReturnType<typeof schemanEditorDocument>,
  sourceEvidence: SourceEvidence,
) {
  return {
    nodes: {
      retained: editor.retainedNodes,
      total: Object.keys(document.nodes).length,
      truncated: editor.nodeTruncated,
    },
    edges: editor.sourceEdges,
    requiredNames: editor.requiredNames,
    definitions: sourceEvidence.definitions.summary,
    diagnostics: sourceEvidence.diagnostics.summary,
  };
}

function schemanProvenance(document: SchemaDocument) {
  const metadata = document.metadata as { readonly provider?: unknown };
  return Object.freeze({
    providerId: "@scheman/core",
    providerVersion: "2.0.0",
    ...(typeof metadata.provider === "string" ? { extractor: metadata.provider } : {}),
  });
}

function sourceDiagnostics(diagnostics: readonly Diagnostic[]): SchemanSourceDiagnostic[] {
  return diagnostics.map((diagnostic) => wrapSourceDiagnostic(diagnostic));
}

interface BoundedSourceRecords<T> {
  readonly values: readonly T[];
  readonly summary: Readonly<{ retained: number; total: number; truncated: boolean }>;
}

interface SourceEvidence {
  readonly definitions: BoundedSourceRecords<SchemaDocument["definitions"][number]>;
  readonly diagnostics: BoundedSourceRecords<Diagnostic>;
}

function boundedSourceEvidence(document: SchemaDocument, maximum: number): SourceEvidence {
  return {
    definitions: boundedRecords(document.definitions, maximum),
    diagnostics: boundedRecords(document.diagnostics, maximum),
  };
}

function boundedRecords<T>(values: readonly T[], maximum: number): BoundedSourceRecords<T> {
  const retained = values.slice(0, maximum);
  return {
    values: retained,
    summary: {
      retained: retained.length,
      total: values.length,
      truncated: retained.length < values.length,
    },
  };
}

function sourceLimitDiagnostics(
  evidence: SourceEvidence,
  editor: ReturnType<typeof schemanEditorDocument>,
): readonly SchemanAdapterDiagnostic[] {
  const sourcePointer = limitSourcePointer(evidence, editor);
  if (!sourcePointer) return Object.freeze([]);
  const diagnostic = Object.freeze({
    code: "SCHEMAN_ADAPTER_ANALYSIS_LIMIT" as const,
    severity: "warning" as const,
    side: "output" as const,
    sourcePointer,
  });
  return Object.freeze([diagnostic]);
}

function limitSourcePointer(
  evidence: SourceEvidence,
  editor: ReturnType<typeof schemanEditorDocument>,
): string | undefined {
  if (evidence.definitions.summary.truncated) return "/definitions";
  if (evidence.diagnostics.summary.truncated) return "/diagnostics";
  if (editor.requiredNames.truncated) return "/nodes/*/required";
  return undefined;
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

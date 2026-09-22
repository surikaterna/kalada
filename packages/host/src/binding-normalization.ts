import type { CapabilityState } from "./capability-normalization.js";
import type {
  CapabilityDeclaration,
  HostEnvironmentDiagnostic,
  HostEnvironmentDiagnosticCode,
  NormalizedBinding,
  ProvenanceEntry,
  SerializableValue,
} from "./contracts.js";
import { environmentDiagnostic } from "./diagnostics.js";
import { validateEditorDocument } from "./editor-input-validation.js";
import type {
  EditorGraphInput,
  EditorUnknownCode,
  ManualEditorShapeDocument,
} from "./editor-types.js";
import { readArray, readStringArray, validName } from "./input-readers.js";
import { cloneSemanticType } from "./semantic-type.js";
import { cloneSerializableData, readOwnDataRecord } from "./serializable.js";

export interface BindingState {
  readonly bindings: Omit<NormalizedBinding, "editorShapeRoot">[];
  readonly graphInputs: EditorGraphInput[];
  readonly diagnostics: HostEnvironmentDiagnostic[];
  readonly providerProvenance: ProvenanceEntry;
}

type MetadataNormalization =
  | Readonly<{ ok: true; value: SerializableValue | undefined }>
  | Readonly<{ ok: false }>;

export function normalizeBindings(
  input: unknown,
  capabilities: CapabilityState,
  providerProvenance: ProvenanceEntry,
): BindingState {
  const state: BindingState = {
    bindings: [],
    graphInputs: [],
    diagnostics: [],
    providerProvenance,
  };
  const items = readArray(input, 10_000);
  if (!items) {
    state.diagnostics.push(environmentDiagnostic("HOST_ENVIRONMENT_INVALID_PROVIDER"));
    return state;
  }
  const identities = new Set<string>();
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const item of items) addBinding(item, capabilities, identities, names, paths, state);
  return state;
}

function addBinding(
  input: unknown,
  capabilities: CapabilityState,
  identities: Set<string>,
  names: Set<string>,
  paths: Set<string>,
  state: BindingState,
): void {
  const inspected = readOwnDataRecord(input, 16);
  if (!inspected.ok) {
    bindingError(state, "HOST_ENVIRONMENT_INVALID_BINDING");
    return;
  }
  const record = inspected.value;
  const path = readStringArray(record.path, 64);
  if (!validName(record.id) || !validName(record.name) || !path) {
    bindingError(state, "HOST_ENVIRONMENT_INVALID_BINDING");
    return;
  }
  if (
    identities.has(record.id) ||
    names.has(record.name as string) ||
    paths.has(JSON.stringify(path))
  ) {
    bindingError(state, "HOST_ENVIRONMENT_DUPLICATE_BINDING", path);
    return;
  }
  identities.add(record.id);
  names.add(record.name as string);
  paths.add(JSON.stringify(path));
  addValidBinding(record, path, capabilities, state);
}

function addValidBinding(
  record: Record<string, unknown>,
  path: readonly string[],
  capabilities: CapabilityState,
  state: BindingState,
): void {
  const semantic = cloneSemanticType(record.semanticType);
  if (!semantic.ok) {
    bindingError(state, "HOST_ENVIRONMENT_INVALID_SEMANTIC_TYPE", path);
    return;
  }
  const metadata = normalizeMetadata(record.metadata, path, state);
  if (!metadata.ok) return;
  const provenance = normalizeProvenance(record.provenance, path, state);
  if (!provenance) return;
  const refs = resolveCapabilityRefs(record, capabilities, path, state);
  if (!refs) return;
  const editor = normalizeEditorDocument(record.editorShape, record.id as string, path, state);
  if (editor === null) return;
  state.bindings.push(makeBinding(record, path, semantic.value, metadata.value, provenance, refs));
  if (editor) state.graphInputs.push(editor);
}

function makeBinding(
  record: Record<string, unknown>,
  path: readonly string[],
  semanticType: NormalizedBinding["semanticType"],
  metadata: SerializableValue | undefined,
  provenance: readonly ProvenanceEntry[],
  refs: { validator?: CapabilityDeclaration; codec?: CapabilityDeclaration },
): Omit<NormalizedBinding, "editorShapeRoot"> {
  return Object.freeze({
    id: record.id as string,
    name: record.name as string,
    path,
    semanticType,
    ...refs,
    ...(metadata === undefined ? {} : { metadata }),
    provenance,
  });
}

function normalizeMetadata(
  input: unknown,
  path: readonly string[],
  state: BindingState,
): MetadataNormalization {
  if (input === undefined) return { ok: true, value: undefined };
  const cloned = cloneSerializableData(input);
  if (cloned.ok) return { ok: true, value: cloned.value };
  bindingError(state, "HOST_ENVIRONMENT_INVALID_METADATA", path);
  return { ok: false };
}

function normalizeProvenance(
  input: unknown,
  path: readonly string[],
  state: BindingState,
): readonly ProvenanceEntry[] | null {
  const base = state.providerProvenance;
  if (input === undefined) return Object.freeze([base]);
  const items = readArray(input, 256);
  if (!items) return provenanceError(state, path);
  const entries: ProvenanceEntry[] = [base];
  for (const item of items) {
    const entry = readProvenance(item);
    if (!entry) return provenanceError(state, path);
    entries.push(entry);
  }
  return Object.freeze(entries);
}

function readProvenance(input: unknown): ProvenanceEntry | null {
  const inspected = readOwnDataRecord(input, 8);
  if (!inspected.ok || !validName(inspected.value.providerId)) return null;
  const record = inspected.value;
  const providerId = record.providerId as string;
  for (const key of ["providerVersion", "source", "extractor", "override"] as const) {
    if (record[key] !== undefined && !validName(record[key])) return null;
  }
  return Object.freeze({
    providerId,
    ...(record.providerVersion ? { providerVersion: record.providerVersion as string } : {}),
    ...(record.source ? { source: record.source as string } : {}),
    ...(record.extractor ? { extractor: record.extractor as string } : {}),
    ...(record.override ? { override: record.override as string } : {}),
  });
}

function resolveCapabilityRefs(
  record: Record<string, unknown>,
  state: CapabilityState,
  path: readonly string[],
  bindings: BindingState,
): { validator?: CapabilityDeclaration; codec?: CapabilityDeclaration } | null {
  const validator = resolveCapability(record.validatorHandle, "validator", state, path, bindings);
  const codec = resolveCapability(record.codecHandle, "codec", state, path, bindings);
  return validator === null || codec === null
    ? null
    : { ...(validator ? { validator } : {}), ...(codec ? { codec } : {}) };
}

function resolveCapability(
  handle: unknown,
  kind: "validator" | "codec",
  state: CapabilityState,
  path: readonly string[],
  bindings: BindingState,
): CapabilityDeclaration | undefined | null {
  if (handle === undefined) return undefined;
  if (!validName(handle)) return unknownCapability(bindings, path);
  const found = state.declarations.find((item) => item.handle === handle && item.kind === kind);
  return found ?? unknownCapability(bindings, path);
}

function normalizeEditorDocument(
  input: unknown,
  bindingId: string,
  path: readonly string[],
  state: BindingState,
): EditorGraphInput | undefined | null {
  if (input === undefined) return undefined;
  const inspected = readOwnDataRecord(input, 4);
  if (!inspected.ok || inspected.value.root === undefined) {
    bindingError(state, "HOST_ENVIRONMENT_INVALID_BINDING", path);
    return null;
  }
  const definitions = normalizeDefinitions(inspected.value.definitions);
  const evidence = normalizeEditorEvidence(inspected.value.evidence);
  if (definitions === null || evidence === null) {
    bindingError(state, "HOST_ENVIRONMENT_INVALID_BINDING", path);
    return null;
  }
  const document: ManualEditorShapeDocument = {
    root: inspected.value.root as never,
    definitions,
    evidence,
  };
  if (!validateEditorDocument(document)) {
    bindingError(state, "HOST_ENVIRONMENT_INVALID_BINDING", path);
    return null;
  }
  return { bindingId, path, document };
}

function normalizeEditorEvidence(input: unknown): readonly EditorUnknownCode[] | null {
  if (input === undefined) return Object.freeze([]);
  const items = readArray(input, 8_192);
  if (!items) return null;
  const allowed = [
    "invalid-shape",
    "unsupported-shape",
    "depth-limit",
    "node-limit",
    "edge-limit",
    "unresolved-reference",
  ];
  return items.every((item) => typeof item === "string" && allowed.includes(item))
    ? Object.freeze(items as EditorUnknownCode[])
    : null;
}

function normalizeDefinitions(input: unknown): ManualEditorShapeDocument["definitions"] | null {
  if (input === undefined) return Object.freeze([]);
  const items = readArray(input, 2_048);
  if (!items) return null;
  const output: { name: string; shape: never }[] = [];
  for (const item of items) {
    const inspected = readOwnDataRecord(item, 4);
    if (!inspected.ok || !validName(inspected.value.name)) return null;
    output.push(
      Object.freeze({ name: inspected.value.name, shape: inspected.value.shape as never }),
    );
  }
  return Object.freeze(output);
}

function bindingError(
  state: BindingState,
  code: HostEnvironmentDiagnosticCode,
  path?: readonly string[],
): undefined {
  state.diagnostics.push(environmentDiagnostic(code, path, state.providerProvenance));
}

function provenanceError(state: BindingState, path: readonly string[]): null {
  bindingError(state, "HOST_ENVIRONMENT_INVALID_PROVENANCE", path);
  return null;
}

function unknownCapability(state: BindingState, path: readonly string[]): null {
  bindingError(state, "HOST_ENVIRONMENT_UNKNOWN_CAPABILITY", path);
  return null;
}

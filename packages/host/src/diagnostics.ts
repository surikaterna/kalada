import type {
  HostDiagnostic,
  HostEnvironmentDiagnosticCode,
  ProvenanceEntry,
} from "./contracts.js";
import type { HostPath } from "./editor-types.js";

const messages: Readonly<Record<HostEnvironmentDiagnosticCode, string>> = Object.freeze({
  HOST_ENVIRONMENT_INVALID_PROVIDER: "The manual provider declaration is invalid.",
  HOST_ENVIRONMENT_INVALID_IDENTITY: "A stable identity declaration is invalid.",
  HOST_ENVIRONMENT_INVALID_CAPABILITY: "A capability declaration is invalid.",
  HOST_ENVIRONMENT_DUPLICATE_CAPABILITY: "A capability handle is duplicated.",
  HOST_ENVIRONMENT_INVALID_BINDING: "A binding declaration is invalid.",
  HOST_ENVIRONMENT_DUPLICATE_BINDING: "A binding identity or path is duplicated.",
  HOST_ENVIRONMENT_INVALID_SEMANTIC_TYPE: "A binding semantic projection is invalid.",
  HOST_ENVIRONMENT_INVALID_METADATA: "Binding metadata is not bounded serializable data.",
  HOST_ENVIRONMENT_INVALID_PROVENANCE: "Binding provenance is invalid.",
  HOST_ENVIRONMENT_UNKNOWN_CAPABILITY: "A binding references an unavailable capability handle.",
});

export function environmentDiagnostic(
  code: HostEnvironmentDiagnosticCode,
  bindingPath?: HostPath,
  provenance?: ProvenanceEntry,
): HostDiagnostic {
  const diagnostic: HostDiagnostic = {
    code,
    phase: "environment",
    message: messages[code],
    ...(bindingPath ? { bindingPath: Object.freeze([...bindingPath]) } : {}),
    ...(provenance ? { provenance: sanitizeProvenance(provenance) } : {}),
  };
  return Object.freeze(diagnostic);
}

function sanitizeProvenance(input: ProvenanceEntry): Readonly<Record<string, string>> {
  const output: Record<string, string> = Object.create(null);
  for (const key of ["providerId", "providerVersion", "source", "extractor", "override"] as const) {
    const value = input[key];
    if (value !== undefined) output[key] = value;
  }
  return Object.freeze(output);
}

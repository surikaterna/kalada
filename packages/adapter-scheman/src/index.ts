export { adaptSchemanDocument } from "./adapter.js";
export { SCHEMAN_MAPPING_FIXTURE_MATRIX, SCHEMAN_SEMANTIC_MAPPING } from "./mapping-table.js";

export const DENY_SCHEMAN_EXECUTION_PERMISSIONS = Object.freeze({
  zod: Object.freeze({ shape: false, lazy: false, metadata: false }),
  standardJson: false,
});

export type {
  AdaptSchemanOptions,
  AdaptSchemanResult,
  KaladaLossPolicy,
  KaladaProfile,
  SchemanAdapterDiagnostic,
  SchemanAdapterDiagnosticCode,
  SchemanBindingOptions,
  SchemanCodecOptions,
  SchemanSourceDiagnostic,
  SchemanValidatorOptions,
  SemanticMappingRule,
} from "./types.js";

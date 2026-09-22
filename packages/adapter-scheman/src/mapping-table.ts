import type { SemanticMappingRule } from "./types.js";

export const SCHEMAN_SEMANTIC_MAPPING: readonly SemanticMappingRule[] = Object.freeze([
  { scheman: "primitive:null|boolean|string", projection: "same primitive", condition: "always" },
  {
    scheman: "primitive:number|integer",
    projection: "number",
    condition: "always; constraints retained",
  },
  {
    scheman: "literal|enum",
    projection: "single primitive domain",
    condition: "all values share one supported domain",
  },
  { scheman: "array", projection: "array-type", condition: "item projection is concrete" },
  {
    scheman: "object|record|tuple",
    projection: "json",
    condition: "entire reachable graph is JSON-safe",
  },
  {
    scheman: "union|intersection",
    projection: "shared concrete type",
    condition: "every operand agrees",
  },
  { scheman: "ref", projection: "target projection", condition: "same-document target resolves" },
  {
    scheman: "wrapper:readonly|brand",
    projection: "inner projection",
    condition: "wrapper is non-transforming",
  },
  { scheman: "unconstrained:json", projection: "json", condition: "JSON domain is explicit" },
  {
    scheman: "unknown|opaque|never|unconstrained:js",
    projection: "dynamic",
    condition: "unless explicitly overridden",
  },
  {
    scheman: "primitive:undefined|void|bigint|symbol|date|NaN",
    projection: "dynamic",
    condition: "unless explicitly overridden",
  },
  {
    scheman: "wrapper:optional|nullable|default|catch|pipeline|effect|coerce",
    projection: "dynamic",
    condition: "unless explicitly overridden",
  },
]);

export const SCHEMAN_MAPPING_FIXTURE_MATRIX = Object.freeze([
  ["primitive-null", "null"],
  ["primitive-boolean", "boolean"],
  ["primitive-string", "string"],
  ["primitive-number", "number"],
  ["primitive-integer", "number"],
  ["literal-primitive", "primitive-domain"],
  ["enum-single-domain", "primitive-domain"],
  ["enum-mixed-domain", "dynamic"],
  ["array-concrete-item", "array-type"],
  ["array-dynamic-item", "dynamic"],
  ["json-safe-object-record-tuple", "json"],
  ["homogeneous-union-intersection", "shared-concrete"],
  ["heterogeneous-union", "dynamic"],
  ["resolved-local-ref", "target"],
  ["unresolved-or-external-ref", "dynamic"],
  ["readonly-or-brand-wrapper", "inner"],
  ["json-unconstrained", "json"],
  ["unknown-opaque-never-js-unconstrained", "dynamic"],
  ["undefined-void-bigint-symbol-date-nan", "dynamic"],
  ["optional-nullable-default-catch-effect-pipeline-coerce", "dynamic"],
  ["unsupported-applicator", "dynamic"],
] as const);

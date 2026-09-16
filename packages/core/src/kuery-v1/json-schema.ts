import { DEFAULT_EXPRESSION_LIMITS } from "./limits.js";
import {
  type ExpressionOperator,
  ExpressionProfile,
  MAX_EXPRESSION_OPERATOR_ARGS,
} from "./profile.js";
import { standardV1 } from "./standard-profile.js";

export type ExpressionJsonSchema = Readonly<Record<string, unknown>>;

const jsonValueSchema = deepFreeze({
  anyOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number", minimum: -1.7976931348623157e308, maximum: 1.7976931348623157e308 },
    { type: "string", maxLength: DEFAULT_EXPRESSION_LIMITS.maxStringLength },
    {
      type: "array",
      maxItems: DEFAULT_EXPRESSION_LIMITS.maxNodes,
      items: { $ref: "#/$defs/jsonValue" },
    },
    {
      type: "object",
      maxProperties: DEFAULT_EXPRESSION_LIMITS.maxNodes,
      propertyNames: {
        allOf: [
          { maxLength: DEFAULT_EXPRESSION_LIMITS.maxStringLength },
          { not: { enum: ["__proto__", "constructor", "prototype"] } },
        ],
      },
      additionalProperties: { $ref: "#/$defs/jsonValue" },
    },
  ],
});

/** Generate a strict JSON Schema from one profile's public operator metadata. */
export function generateExpressionJsonSchema(profile: ExpressionProfile): ExpressionJsonSchema {
  if (!(profile instanceof ExpressionProfile))
    throw new TypeError("An expression profile is required.");
  const operatorSchemas = profile.definitions.map(operatorSchema);
  return deepFreeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://kuery.dev/schema/expression/${encodeURIComponent(profile.name)}`,
    $comment:
      "This schema enforces recursive shape and profile constraints only; aggregate maxNodes and maxDepth limits are runtime-authoritative during canonicalization and compilation.",
    $ref: "#/$defs/expression",
    $defs: {
      jsonValue: jsonValueSchema,
      expression: {
        oneOf: [
          literalSchema(),
          referenceSchema(),
          ...(operatorSchemas.length ? operatorSchemas : [neverSchema()]),
        ],
      },
    },
  });
}

function neverSchema(): false {
  return false;
}

/** Strict schema for the built-in standard-v1 profile and default string references. */
export function getStandardExpressionJsonSchema(): ExpressionJsonSchema {
  return generateExpressionJsonSchema(standardV1);
}

function literalSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { kind: { const: "literal" }, value: { $ref: "#/$defs/jsonValue" } },
    required: ["kind", "value"],
    additionalProperties: false,
  };
}

function referenceSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      kind: { const: "ref" },
      ref: {
        type: "string",
        minLength: 1,
        maxLength: DEFAULT_EXPRESSION_LIMITS.maxReferenceLength,
      },
    },
    required: ["kind", "ref"],
    additionalProperties: false,
  };
}

function operatorSchema(operator: ExpressionOperator): Record<string, unknown> {
  const args: Record<string, unknown> = {
    type: "array",
    items: { $ref: "#/$defs/expression" },
    minItems: operator.arity ?? operator.minArgs ?? 0,
    maxItems: operator.arity ?? operator.maxArgs ?? MAX_EXPRESSION_OPERATOR_ARGS,
  };
  return {
    type: "object",
    properties: {
      kind: { const: "op" },
      op: { const: operator.name },
      args,
    },
    required: ["kind", "op", "args"],
    additionalProperties: false,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

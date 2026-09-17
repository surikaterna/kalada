import { DEFAULT_KALADA_V1_LIMITS } from "./limits.js";

export type KaladaV1JsonSchema = Readonly<Record<string, unknown>>;

const jsonValue = {
  anyOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number", minimum: -1.7976931348623157e308, maximum: 1.7976931348623157e308 },
    { type: "string", maxLength: DEFAULT_KALADA_V1_LIMITS.maxStringLength },
    {
      type: "array",
      maxItems: DEFAULT_KALADA_V1_LIMITS.maxNodes,
      items: { $ref: "#/$defs/jsonValue" },
    },
    {
      type: "object",
      maxProperties: DEFAULT_KALADA_V1_LIMITS.maxNodes,
      propertyNames: {
        allOf: [
          { maxLength: DEFAULT_KALADA_V1_LIMITS.maxStringLength },
          { not: { enum: ["__proto__", "constructor", "prototype"] } },
        ],
      },
      additionalProperties: { $ref: "#/$defs/jsonValue" },
    },
  ],
};

const expression = {
  oneOf: [
    node("literal", { value: { $ref: "#/$defs/jsonValue" } }, ["value"]),
    node(
      "ref",
      {
        ref: {
          type: "string",
          minLength: 1,
          maxLength: DEFAULT_KALADA_V1_LIMITS.maxReferenceLength,
        },
      },
      ["ref"],
    ),
    node("binding", { name: bindingName(), value: expressionRef(), body: expressionRef() }, [
      "name",
      "value",
      "body",
    ]),
    node("option", { variant: { const: "none" } }, ["variant"]),
    node("option", { variant: { const: "some" }, value: expressionRef() }, ["variant", "value"]),
    node("result", { variant: { enum: ["ok", "err"] }, value: expressionRef() }, [
      "variant",
      "value",
    ]),
    matchNode("Option", [arm("some", true), arm("none", false)]),
    matchNode("Result", [arm("ok", true), arm("err", true)]),
  ],
};

export const KALADA_V1_PROGRAM_SCHEMA: KaladaV1JsonSchema = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kalada.dev/schema/program/kalada-v1",
  $comment:
    "Shape is canonical; aggregate depth, node, and evaluation limits remain runtime-authoritative.",
  type: "object",
  properties: {
    format: { const: "kalada-program" },
    version: { const: 1 },
    profile: { const: "kalada-v1" },
    expression: expressionRef(),
  },
  required: ["format", "version", "profile", "expression"],
  additionalProperties: false,
  $defs: { jsonValue, expression },
});

export const KALADA_VALUE_V1_SCHEMA: KaladaV1JsonSchema = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kalada.dev/schema/value/kalada-value-v1",
  $ref: "#/$defs/encodedValue",
  $defs: {
    jsonValue,
    encodedValue: {
      oneOf: [
        valueEnvelope("Json", "value", { $ref: "#/$defs/jsonValue" }),
        valueEnvelope("Option", "none"),
        valueEnvelope("Option", "some", { $ref: "#/$defs/encodedValue" }),
        valueEnvelope("Result", "ok", { $ref: "#/$defs/encodedValue" }),
        valueEnvelope("Result", "err", { $ref: "#/$defs/encodedValue" }),
      ],
    },
  },
});

function node(
  kind: string,
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { kind: { const: kind }, ...properties },
    required: ["kind", ...required],
    additionalProperties: false,
  };
}

function matchNode(
  type: "Option" | "Result",
  arms: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return node(
    "match",
    {
      type: { const: type },
      value: expressionRef(),
      arms: { type: "array", prefixItems: arms, minItems: 2, maxItems: 2 },
    },
    ["type", "value", "arms"],
  );
}

function arm(variant: string, payload: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    variant: { const: variant },
    body: expressionRef(),
  };
  if (payload) properties.binding = bindingName();
  return { type: "object", properties, required: ["variant", "body"], additionalProperties: false };
}

function valueEnvelope(
  type: string,
  variant: string,
  value?: Record<string, unknown>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    format: { const: "kalada-value" },
    version: { const: 1 },
    type: { const: type },
    variant: { const: variant },
  };
  if (value) properties.value = value;
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function expressionRef(): Record<string, string> {
  return { $ref: "#/$defs/expression" };
}

function bindingName(): Record<string, unknown> {
  return { type: "string", minLength: 1, maxLength: DEFAULT_KALADA_V1_LIMITS.maxReferenceLength };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

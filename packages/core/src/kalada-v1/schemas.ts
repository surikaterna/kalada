import { DEFAULT_KALADA_V1_FUNCTION_LIMITS, DEFAULT_KALADA_V1_LIMITS } from "./limits.js";

export type KaladaV1JsonSchema = Readonly<Record<string, unknown>>;

const jsonValue = jsonValueSchema("#/$defs/jsonValue", DEFAULT_KALADA_V1_LIMITS.maxValueNodes - 1);
const encodedJsonValue = jsonValueSchema(
  "#/$defs/encodedJsonValue",
  DEFAULT_KALADA_V1_LIMITS.maxValueNodes - 2,
);

function jsonValueSchema(reference: string, maxContainerSize: number): Record<string, unknown> {
  return {
    anyOf: [
      { type: "null" },
      { type: "boolean" },
      { type: "number", minimum: -1.7976931348623157e308, maximum: 1.7976931348623157e308 },
      { type: "string", maxLength: DEFAULT_KALADA_V1_LIMITS.maxStringLength },
      {
        type: "array",
        maxItems: maxContainerSize,
        items: { $ref: reference },
      },
      {
        type: "object",
        maxProperties: maxContainerSize,
        propertyNames: {
          allOf: [
            { maxLength: DEFAULT_KALADA_V1_LIMITS.maxStringLength },
            { not: { enum: ["__proto__", "constructor", "prototype"] } },
          ],
        },
        additionalProperties: { $ref: reference },
      },
    ],
  };
}

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
    node("instant", { milliseconds: safeInteger() }, ["milliseconds"]),
    node("duration", { milliseconds: safeInteger() }, ["milliseconds"]),
    node("current-instant", {}, []),
    temporalNode("temporal-arithmetic", ["add", "subtract"]),
    temporalNode("temporal-comparison", [
      "equal",
      "not-equal",
      "less-than",
      "less-than-or-equal",
      "greater-than",
      "greater-than-or-equal",
    ]),
    matchNode("Option", [arm("some", true), arm("none", false)]),
    matchNode("Result", [arm("ok", true), arm("err", true)]),
    node(
      "function",
      { parameters: parametersSchema(), returns: typeRef(), body: expressionRef() },
      ["parameters", "returns", "body"],
    ),
    node(
      "call",
      {
        callee: expressionRef(),
        arguments: {
          type: "array",
          maxItems: DEFAULT_KALADA_V1_LIMITS.maxAstNodes,
          items: expressionRef(),
        },
      },
      ["callee", "arguments"],
    ),
    node(
      "function-group",
      {
        functions: {
          type: "array",
          maxItems: DEFAULT_KALADA_V1_FUNCTION_LIMITS.maxFunctionGroupSize,
          items: { $ref: "#/$defs/namedFunction" },
        },
        body: expressionRef(),
      },
      ["functions", "body"],
    ),
    node("core-function", { name: { enum: ["map", "filter", "some", "every"] } }, ["name"]),
  ],
};

export const KALADA_V1_FUNCTION_PROGRAM_SCHEMA: KaladaV1JsonSchema = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kalada.dev/schema/program/kalada-v1-functions",
  $comment:
    "The schema enforces canonical shape and local string/container bounds. Aggregate AST depth, AST nodes, value nodes, and evaluation steps remain runtime-authoritative.",
  type: "object",
  properties: {
    format: { const: "kalada-program" },
    version: { const: 1 },
    profile: { const: "kalada-v1" },
    expression: expressionRef(),
  },
  required: ["format", "version", "profile", "expression"],
  additionalProperties: false,
  $defs: {
    jsonValue,
    expression,
    kaladaType: typeSchema(),
    parameter: {
      type: "object",
      properties: { name: bindingName(), type: typeRef() },
      required: ["name", "type"],
      additionalProperties: false,
    },
    namedFunction: {
      type: "object",
      properties: {
        name: bindingName(),
        parameters: parametersSchema(),
        returns: typeRef(),
        body: expressionRef(),
      },
      required: ["name", "parameters", "returns", "body"],
      additionalProperties: false,
    },
  },
});

const legacyExpression = { oneOf: expression.oneOf.slice(0, 13) };

export const KALADA_V1_PROGRAM_SCHEMA: KaladaV1JsonSchema = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kalada.dev/schema/program/kalada-v1",
  $comment:
    "The schema enforces canonical shape and local string/container bounds. Aggregate AST depth, AST nodes, value nodes, and evaluation steps remain runtime-authoritative.",
  type: "object",
  properties: {
    format: { const: "kalada-program" },
    version: { const: 1 },
    profile: { const: "kalada-v1" },
    expression: expressionRef(),
  },
  required: ["format", "version", "profile", "expression"],
  additionalProperties: false,
  $defs: { jsonValue, expression: legacyExpression },
});

export const KALADA_VALUE_V1_SCHEMA: KaladaV1JsonSchema = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kalada.dev/schema/value/kalada-value-v1",
  $ref: "#/$defs/encodedValue",
  $defs: {
    encodedJsonValue,
    encodedValue: {
      oneOf: [
        valueEnvelope("Json", "value", { $ref: "#/$defs/encodedJsonValue" }),
        valueEnvelope("Option", "none"),
        valueEnvelope("Option", "some", { $ref: "#/$defs/encodedValue" }),
        valueEnvelope("Result", "ok", { $ref: "#/$defs/encodedValue" }),
        valueEnvelope("Result", "err", { $ref: "#/$defs/encodedValue" }),
        valueEnvelope("Instant", "milliseconds", safeInteger()),
        valueEnvelope("Duration", "milliseconds", safeInteger()),
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

function temporalNode(kind: string, operators: readonly string[]): Record<string, unknown> {
  return node(
    kind,
    { operator: { enum: operators }, left: expressionRef(), right: expressionRef() },
    ["operator", "left", "right"],
  );
}

function safeInteger(): Record<string, unknown> {
  return {
    type: "integer",
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
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

function parametersSchema(): Record<string, unknown> {
  return {
    type: "array",
    maxItems: DEFAULT_KALADA_V1_FUNCTION_LIMITS.maxFunctionParameters,
    items: { $ref: "#/$defs/parameter" },
  };
}

function typeRef(): Record<string, string> {
  return { $ref: "#/$defs/kaladaType" };
}

function typeSchema(): Record<string, unknown> {
  const primitive = node(
    "primitive-type",
    { name: { enum: ["null", "boolean", "number", "string", "json", "Instant", "Duration"] } },
    ["name"],
  );
  return {
    oneOf: [
      primitive,
      node("option-type", { value: typeRef() }, ["value"]),
      node("result-type", { ok: typeRef(), error: typeRef() }, ["ok", "error"]),
      node("array-type", { element: typeRef() }, ["element"]),
      node(
        "function-type",
        {
          parameters: {
            type: "array",
            maxItems: DEFAULT_KALADA_V1_FUNCTION_LIMITS.maxFunctionParameters,
            items: typeRef(),
          },
          returns: typeRef(),
        },
        ["parameters", "returns"],
      ),
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

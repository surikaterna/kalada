import type { DemoWorkspaceEnvelopeV1 } from "../workspace/transfer.js";

export const BUILTIN_WORKSPACE: DemoWorkspaceEnvelopeV1 = Object.freeze({
  format: "kalada-demo-workspace",
  version: 1,
  schemaText: JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { name: { type: "string", minLength: 1 } },
          required: ["name"],
          additionalProperties: false,
        },
        count: { type: "number" },
        enabled: { type: "boolean" },
      },
      required: ["user", "count", "enabled"],
      additionalProperties: false,
    },
    null,
    2,
  ),
  schemaRevision: 1,
  dataText: JSON.stringify({ user: { name: "Ada" }, count: 2, enabled: true }, null, 2),
  dataRevision: 1,
  documents: Object.freeze([
    Object.freeze({ name: "greeting.kalada", text: "data.user.name", revision: 1 }),
    Object.freeze({ name: "count.kalada", text: "data.count + 1", revision: 1 }),
    Object.freeze({
      name: "enabled.kalada",
      text: 'data.enabled ? data.user.name : "off"',
      revision: 1,
    }),
  ]),
  activeName: "greeting.kalada",
  seed: 1,
  generatorVersion: "demo-input-candidate-v1",
});

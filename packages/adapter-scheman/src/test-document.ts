import type { OwnedValue, SchemaDocument, SchemaNode } from "@scheman/core";

export function testDocument(
  output: SchemaNode,
  input: SchemaNode = output,
  extras: Readonly<Record<string, SchemaNode>> = {},
): SchemaDocument {
  return {
    formatVersion: 1,
    root: { input: { nodeId: "input" }, output: { nodeId: input === output ? "input" : "output" } },
    nodes: { input, ...(input === output ? {} : { output }), ...extras },
    definitions: [],
    metadata: { provider: "test" },
    capabilities: { input: "complete", output: "complete" },
    diagnostics: [],
  };
}

export function metadataProfile(payload: OwnedValue): OwnedValue {
  return { "x-kalada": payload };
}

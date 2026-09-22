import type { DemoEnvironment } from "../schema/environment.js";
import { boolean, number, omitted, ownArray, ownData, text } from "./own.js";
import { typeSnapshot } from "./program.js";

const CONSTRAINT_KEYS = [
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
] as const;

export function environmentSnapshotValue(environment: DemoEnvironment): unknown {
  const normalized = ownData(ownData(environment, "adapted"), "environment");
  return {
    schema: schemaSnapshot(ownData(environment, "document")),
    environment: {
      format: ownData(normalized, "format"),
      provider: providerSnapshot(ownData(normalized, "provider")),
      cacheability: cacheabilitySnapshot(ownData(normalized, "cacheability")),
      compileProjection: projectionSnapshot(ownData(normalized, "compileProjection")),
      bindings: ownArray(ownData(normalized, "bindings")).map(bindingSnapshot),
      graph: graphSnapshot(ownData(normalized, "editorGraph")),
    },
  };
}

function schemaSnapshot(document: unknown): unknown {
  const roots = ownData(document, "root");
  const nodes = ownData(document, "nodes");
  const entries = nodes && typeof nodes === "object" ? Object.keys(nodes).sort() : [];
  return {
    formatVersion: ownData(document, "formatVersion"),
    root: {
      input: refSnapshot(ownData(roots, "input")),
      output: refSnapshot(ownData(roots, "output")),
    },
    capabilities: {
      input: ownData(ownData(document, "capabilities"), "input"),
      output: ownData(ownData(document, "capabilities"), "output"),
    },
    definitions: ownArray(ownData(document, "definitions")).map(schemaDefinitionSnapshot),
    nodes: entries.map((id) => ({ id, node: schemaNodeSnapshot(ownData(nodes, id)) })),
  };
}

function schemaDefinitionSnapshot(value: unknown): unknown {
  return {
    side: ownData(value, "side"),
    sourcePointer: ownData(value, "sourcePointer"),
    ...(text(ownData(value, "name")) === undefined ? {} : { name: ownData(value, "name") }),
    node: refSnapshot(ownData(value, "node")),
  };
}

function schemaNodeSnapshot(value: unknown): unknown {
  const kind = ownData(value, "kind");
  const base = {
    kind,
    constraints: constraintsSnapshot(ownData(value, "constraints")),
    applicators: applicatorsSnapshot(ownData(value, "applicators")),
  };
  if (kind === "primitive") return { ...base, type: ownData(value, "type") };
  if (kind === "unconstrained") return { ...base, domain: ownData(value, "domain") };
  if (kind === "object") return schemaObjectSnapshot(value, base);
  const composite = schemaCompositeSnapshot(value, kind, base);
  if (composite) return composite;
  if (["literal", "enum", "never", "opaque", "unknown"].includes(kind as string)) return base;
  return omitted();
}

function schemaCompositeSnapshot(value: unknown, kind: unknown, base: object): unknown | undefined {
  if (kind === "array") return { ...base, items: refSnapshot(ownData(value, "items")) };
  if (kind === "tuple")
    return {
      ...base,
      items: ownArray(ownData(value, "items")).map(refSnapshot),
      ...(ownData(value, "rest") === undefined
        ? {}
        : { rest: refSnapshot(ownData(value, "rest")) }),
    };
  if (kind === "union")
    return {
      ...base,
      semantics: ownData(value, "semantics"),
      alternatives: ownArray(ownData(value, "alternatives")).map(refSnapshot),
    };
  if (kind === "intersection")
    return { ...base, operands: ownArray(ownData(value, "operands")).map(refSnapshot) };
  if (kind === "record")
    return {
      ...base,
      key: refSnapshot(ownData(value, "key")),
      value: refSnapshot(ownData(value, "value")),
      exhaustive: ownData(value, "exhaustive"),
    };
  if (kind === "ref")
    return {
      ...base,
      reference: ownData(value, "reference"),
      ...(ownData(value, "target") === undefined
        ? {}
        : { target: refSnapshot(ownData(value, "target")) }),
    };
  if (kind === "wrapper")
    return {
      ...base,
      wrapper: ownData(value, "wrapper"),
      inner: refSnapshot(ownData(value, "inner")),
    };
  return undefined;
}

function schemaObjectSnapshot(value: unknown, base: object): unknown {
  return {
    ...base,
    properties: ownArray(ownData(value, "properties")).map((property) => ({
      name: ownData(property, "name"),
      presence: ownData(property, "presence"),
      node: refSnapshot(ownData(property, "node")),
    })),
    required: ownArray(ownData(value, "required")),
    unknownKeys: ownData(value, "unknownKeys"),
    ...(ownData(value, "additionalProperties") === undefined
      ? {}
      : { additionalProperties: refSnapshot(ownData(value, "additionalProperties")) }),
  };
}

function applicatorsSnapshot(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, unknown> = {};
  for (const key of ["if", "then", "else", "not", "contains", "propertyNames"])
    if (ownData(value, key) !== undefined) output[key] = refSnapshot(ownData(value, key));
  for (const key of ["patternProperties", "dependentSchemas"]) {
    const record = ownData(value, key);
    if (!record || typeof record !== "object") continue;
    output[key] = Object.keys(record)
      .sort()
      .map((name) => ({ name, node: refSnapshot(ownData(record, name)) }));
  }
  return output;
}

function graphSnapshot(graph: unknown): unknown {
  return {
    format: ownData(graph, "format"),
    roots: ownArray(ownData(graph, "roots")).map((root) => ({
      bindingId: ownData(root, "bindingId"),
      ...edgeSnapshot(root),
    })),
    nodes: ownArray(ownData(graph, "nodes")).map(graphNodeSnapshot),
    definitions: ownArray(ownData(graph, "definitions")).map((definition) => ({
      bindingId: ownData(definition, "bindingId"),
      name: ownData(definition, "name"),
      nodeId: ownData(definition, "nodeId"),
      path: pathSnapshot(ownData(definition, "path")),
    })),
    evidence: evidenceSnapshot(ownData(graph, "evidence")),
    limits: limitsSnapshot(ownData(graph, "limits")),
  };
}

function graphNodeSnapshot(value: unknown): unknown {
  const kind = ownData(value, "kind");
  const base = {
    id: ownData(value, "id"),
    kind,
    availability: ownData(value, "availability"),
    evidence: evidenceSnapshot(ownData(value, "evidence")),
    constraints: constraintsSnapshot(ownData(value, "constraints")),
  };
  if (kind === "scalar") return { ...base, name: ownData(value, "name") };
  const collection = graphCollectionSnapshot(value, kind, base);
  if (collection) return collection;
  return graphRelationSnapshot(value, kind, base);
}

function graphCollectionSnapshot(value: unknown, kind: unknown, base: object): unknown | undefined {
  if (kind === "object")
    return {
      ...base,
      properties: ownArray(ownData(value, "properties")).map((property) => ({
        name: ownData(property, "name"),
        required: ownData(property, "required"),
        presence: ownData(property, "presence"),
        ...edgeSnapshot(property),
      })),
      ...(ownData(value, "additionalProperties") === undefined
        ? {}
        : { additionalProperties: edgeSnapshot(ownData(value, "additionalProperties")) }),
    };
  if (kind === "array") return { ...base, element: edgeSnapshot(ownData(value, "element")) };
  if (kind === "tuple")
    return {
      ...base,
      items: ownArray(ownData(value, "items")).map(edgeSnapshot),
      ...(ownData(value, "rest") === undefined
        ? {}
        : { rest: edgeSnapshot(ownData(value, "rest")) }),
    };
  if (kind === "union")
    return {
      ...base,
      semantics: ownData(value, "semantics"),
      variants: ownArray(ownData(value, "variants")).map(edgeSnapshot),
    };
  return undefined;
}

function graphRelationSnapshot(value: unknown, kind: unknown, base: object): unknown {
  if (kind === "intersection")
    return { ...base, operands: ownArray(ownData(value, "operands")).map(edgeSnapshot) };
  if (kind === "record")
    return {
      ...base,
      key: edgeSnapshot(ownData(value, "key")),
      value: edgeSnapshot(ownData(value, "value")),
      exhaustive: ownData(value, "exhaustive"),
    };
  if (kind === "reference")
    return {
      ...base,
      status: ownData(value, "status"),
      ...(ownData(value, "target") === undefined
        ? {}
        : { target: edgeSnapshot(ownData(value, "target")) }),
    };
  if (kind === "wrapper")
    return {
      ...base,
      wrapper: ownData(value, "wrapper"),
      inner: edgeSnapshot(ownData(value, "inner")),
    };
  if (["literal", "enum", "never", "unconstrained", "opaque", "unknown"].includes(kind as string))
    return kind === "unconstrained" ? { ...base, domain: ownData(value, "domain") } : base;
  return omitted();
}

function projectionSnapshot(value: unknown): unknown {
  return {
    format: ownData(value, "format"),
    bindings: ownArray(ownData(value, "bindings")).map((binding) => ({
      id: ownData(binding, "id"),
      name: ownData(binding, "name"),
      semanticType: typeSnapshot(ownData(binding, "semanticType")),
    })),
  };
}

function bindingSnapshot(value: unknown): unknown {
  return {
    id: ownData(value, "id"),
    name: ownData(value, "name"),
    path: pathSnapshot(ownData(value, "path")),
    semanticType: typeSnapshot(ownData(value, "semanticType")),
    editorShapeRoot: ownData(value, "editorShapeRoot"),
  };
}

function providerSnapshot(value: unknown): unknown {
  return {
    mode: ownData(value, "mode"),
    providerId: ownData(value, "providerId"),
    providerVersion: ownData(value, "providerVersion"),
  };
}

function cacheabilitySnapshot(value: unknown): unknown {
  return ownData(value, "cacheable") === true
    ? { cacheable: true }
    : { cacheable: false, reason: ownData(value, "reason") };
}

function constraintsSnapshot(value: unknown): unknown {
  const output: Record<string, number> = {};
  for (const key of CONSTRAINT_KEYS) {
    const item = number(ownData(value, key));
    if (item !== undefined) output[key] = item;
  }
  return output;
}

function refSnapshot(value: unknown): unknown {
  return { nodeId: ownData(value, "nodeId") };
}

function edgeSnapshot(value: unknown): object {
  return {
    nodeId: ownData(value, "nodeId"),
    path: pathSnapshot(ownData(value, "path")),
    cycle: boolean(ownData(value, "cycle")),
  };
}

function evidenceSnapshot(value: unknown): unknown {
  return ownArray(value).map((item) => ({
    code: ownData(item, "code"),
    path: pathSnapshot(ownData(item, "path")),
  }));
}

function pathSnapshot(value: unknown): unknown {
  return ownArray(value).filter((item) => typeof item === "string" || typeof item === "number");
}

function limitsSnapshot(value: unknown): unknown {
  return {
    maxDepth: number(ownData(value, "maxDepth")),
    maxNodes: number(ownData(value, "maxNodes")),
    maxEdges: number(ownData(value, "maxEdges")),
  };
}

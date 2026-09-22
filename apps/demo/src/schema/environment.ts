import { type AdaptSchemanResult, adaptSchemanDocument } from "@kalada/adapter-scheman";
import { ingestSchemaDocument, jsonSchemaProvider, type SchemaDocument } from "@scheman/core";
import { type AdmittedSchema, admitSchemaText } from "./admission.js";
import { createWholeDataValidator, type WholeDataValidator } from "./validator.js";

export const DEMO_BINDING = Object.freeze({ id: "demo:data", name: "data", path: ["data"] });

export interface DemoEnvironment {
  readonly admitted: AdmittedSchema;
  readonly document: SchemaDocument;
  readonly validator: WholeDataValidator;
  readonly adapted: Extract<AdaptSchemanResult, { ok: true }>;
  readonly configurationDigest: string;
}

export async function createDemoEnvironment(schemaText: string): Promise<DemoEnvironment> {
  const admitted = admitSchemaText(schemaText);
  const schemanCopy = copyJson(admitted.schema);
  const validatorCopy = admitSchema(copyJson(admitted.schema));
  const ingested = ingestSchemaDocument(schemanCopy, {
    provider: jsonSchemaProvider({ dialect: "draft-2020-12" }),
    limits: {
      maxDepth: 32,
      maxNodes: 512,
      maxDefinitions: 128,
      maxDiagnostics: 128,
      maxEdges: 2048,
      maxMetadataEntries: 2048,
      maxMetadataBytes: 64 * 1024,
    },
  });
  const digest = await sha256(`demo-json-2020-12-v1\n${admitted.canonical}\ndemo:data`);
  const validator = createWholeDataValidator(validatorCopy);
  const adapted = adaptSchemanDocument({
    document: ingested.document,
    mode: "sync",
    providerId: "demo.scheman-json",
    providerVersion: "2.0.0/demo-json-2020-12-v1",
    configurationDigest: digest,
    cacheable: true,
    binding: DEMO_BINDING,
    validator: {
      validator: validator.standard,
      mode: "sync",
      capabilityId: "demo-json-validator",
      capabilityVersion: "4.1.1/demo-json-2020-12-v1",
      configurationDigest: digest,
      cacheable: true,
    },
    analysisLimits: { maxNodes: 512, maxEdges: 2048, maxTypeDepth: 32 },
  });
  if (!adapted.ok) throw new Error("DEMO_ENVIRONMENT_ADAPTER_FAILED");
  return Object.freeze({
    admitted,
    document: ingested.document,
    validator,
    adapted,
    configurationDigest: digest,
  });
}

function admitSchema(schema: unknown): AdmittedSchema {
  return admitSchemaText(JSON.stringify(schema));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

import { adaptSchemanDocument } from "@kalada/adapter-scheman";
import { ingestSchemaDocument, jsonSchemaProvider } from "@scheman/core";

const { document: schemaDocument } = ingestSchemaDocument(
  { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  { provider: jsonSchemaProvider() },
);
const result = adaptSchemanDocument({
  document: schemaDocument,
  mode: "sync",
  providerId: "browser",
  providerVersion: "1",
  configurationDigest: "sha256:browser",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
});
document.documentElement.dataset.kalada = result.ok ? "passed" : "failed";

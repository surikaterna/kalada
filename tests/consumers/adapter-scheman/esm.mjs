import { adaptSchemanDocument } from "@kalada/adapter-scheman";
import { ingestSchemaDocument, jsonSchemaProvider } from "@scheman/core";

const { document } = ingestSchemaDocument(
  { type: "array", items: { type: "string" } },
  { provider: jsonSchemaProvider() },
);
const result = adaptSchemanDocument({
  document,
  mode: "sync",
  providerId: "smoke",
  providerVersion: "1",
  configurationDigest: "sha256:smoke",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
});
if (!result.ok || result.environment.bindings[0]?.semanticType === "dynamic") {
  throw new Error("Adapter ESM smoke failed");
}

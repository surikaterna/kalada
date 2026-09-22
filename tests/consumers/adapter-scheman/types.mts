import { type AdaptSchemanOptions, adaptSchemanDocument } from "@kalada/adapter-scheman";
import { ingestSchemaDocument, jsonSchemaProvider } from "@scheman/core";

const { document } = ingestSchemaDocument({ type: "string" }, { provider: jsonSchemaProvider() });
const options: AdaptSchemanOptions = {
  document,
  mode: "sync",
  providerId: "types",
  providerVersion: "1",
  configurationDigest: "sha256:types",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
};
void adaptSchemanDocument(options);

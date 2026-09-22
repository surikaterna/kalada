import adapter = require("@kalada/adapter-scheman");
import scheman = require("@scheman/core");

const { document } = scheman.ingestSchemaDocument(
  { type: "string" },
  { provider: scheman.jsonSchemaProvider() },
);
const options: adapter.AdaptSchemanOptions = {
  document,
  mode: "sync",
  providerId: "types",
  providerVersion: "1",
  configurationDigest: "sha256:types",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
};
void adapter.adaptSchemanDocument(options);

const adapter = require("@kalada/adapter-scheman");
const scheman = require("@scheman/core");

const { document } = scheman.ingestSchemaDocument(
  { type: "string" },
  { provider: scheman.jsonSchemaProvider() },
);
const result = adapter.adaptSchemanDocument({
  document,
  mode: "sync",
  providerId: "smoke",
  providerVersion: "1",
  configurationDigest: "sha256:smoke",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
});
if (!result.ok) throw new Error("Adapter CJS smoke failed");

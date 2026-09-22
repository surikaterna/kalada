import { type DescribeEnvironmentResult, normalizeManualEnvironment } from "@kalada/host";

export function validEnvironment(): DescribeEnvironmentResult {
  return normalizeManualEnvironment({
    mode: "sync",
    bindings: [
      {
        id: "price-id",
        name: "price",
        path: ["price"],
        semanticType: { kind: "primitive-type", name: "number" },
      },
    ],
  });
}

export function invalidEnvironment(): DescribeEnvironmentResult {
  return normalizeManualEnvironment({
    mode: "sync",
    providerId: "fixture-provider",
    providerVersion: "1",
    configurationDigest: "fixture",
    bindings: [
      {
        id: "invalid",
        name: "invalid",
        path: ["invalid"],
        semanticType: "not-a-type" as never,
      },
    ],
  });
}

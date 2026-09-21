import {
  type ManualProviderInput,
  type NormalizedEnvironment,
  normalizeManualEnvironment,
} from "@kalada/host";

const input: ManualProviderInput = { mode: "sync", bindings: [] };
const result = normalizeManualEnvironment(input);
const environment: NormalizedEnvironment | undefined = result.ok ? result.environment : undefined;
void environment;

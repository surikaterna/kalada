import {
  createManualProvider,
  type ManualProviderInput,
  type NormalizedEnvironment,
  normalizeManualEnvironment,
  type PreparedExpression,
  prepareExpression,
} from "@kalada/host";

const input: ManualProviderInput = { mode: "sync", bindings: [] };
const result = normalizeManualEnvironment(input);
const environment: NormalizedEnvironment | undefined = result.ok ? result.environment : undefined;
void environment;
const preparedResult = prepareExpression("1", createManualProvider(input));
const prepared: PreparedExpression | undefined = preparedResult.ok
  ? preparedResult.value
  : undefined;
void prepared;

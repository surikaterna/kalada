import host = require("@kalada/host");

const input: host.ManualProviderInput = { mode: "sync", bindings: [] };
const result: host.DescribeEnvironmentResult = host.normalizeManualEnvironment(input);
const preparedResult: host.PrepareExpressionResult = host.prepareExpression(
  "1",
  host.createManualProvider(input),
);
const prepared: host.PreparedExpression | undefined = preparedResult.ok
  ? preparedResult.value
  : undefined;
void result;
void prepared;

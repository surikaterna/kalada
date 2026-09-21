import host = require("@kalada/host");

const input: host.ManualProviderInput = { mode: "sync", bindings: [] };
const result: host.DescribeEnvironmentResult = host.normalizeManualEnvironment(input);
void result;

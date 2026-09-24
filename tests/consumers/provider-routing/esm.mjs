import { createDiagnosticRouter, DIAGNOSTIC_CONTRACT_VERSION } from "@kalada/provider-routing";
import { checkDomain, domain } from "./domain.mjs";

if (DIAGNOSTIC_CONTRACT_VERSION !== 1) throw new Error("Contract version drifted");
checkDomain();
const input = {
  uri: "file:///domain",
  text: "use alpha",
  version: 1,
  environmentGeneration: "names-v1",
};
const broken = {
  languageId: "broken",
  diagnose: () => ({
    status: "invalid",
    diagnostics: [{ code: "oops", range: { start: 0, end: 99 } }],
  }),
};
const router = createDiagnosticRouter([domain, broken]);
if (router.diagnose("broken", input).diagnostics[0].code !== "PROVIDER_INVALID_RESULT")
  throw new Error("Malformed result accepted");
if (
  router.diagnose("domain", { ...input, text: "x".repeat(100_001) }).diagnostics[0].code !==
  "PROVIDER_SOURCE_LIMIT"
)
  throw new Error("Source bound failed");
if (
  createDiagnosticRouter([
    {
      languageId: "fail",
      diagnose: () => {
        throw Error("secret");
      },
    },
  ]).diagnose("fail", input).diagnostics[0].code !== "PROVIDER_FAILURE"
)
  throw new Error("Failure leaked");
for (const action of [
  () => createDiagnosticRouter([domain, domain]),
  () => router.diagnose("missing", input),
  () => router.diagnose("domain", { ...input, version: -1 }),
]) {
  try {
    action();
    throw new Error("Missing rejection");
  } catch (error) {
    if (error.message === "Missing rejection") throw error;
  }
}

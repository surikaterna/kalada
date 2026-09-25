import { normalizeManualEnvironment } from "@kalada/host";
import {
  createExpressionsDiagnosticProvider,
  createLanguageService,
  createUtf16LineIndex,
} from "@kalada/language-service";
import { createDiagnosticRouter } from "@kalada/provider-routing";
import { checkDomain, domain } from "./domain.mjs";

const description = normalizeManualEnvironment({
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
const environments = new Map([["types-v1", { environmentGeneration: "types-v1", description }]]);
const expressions = createExpressionsDiagnosticProvider((generation) =>
  environments.get(generation),
);
const router = createDiagnosticRouter([domain, expressions]);
checkDomain(router);
const input = {
  uri: "file:///expr",
  text: "price + 1",
  version: 4,
  environmentGeneration: "types-v1",
};

function oracle(text) {
  const service = createLanguageService({ generation: 0, description });
  service.openDocument({ ...input, text });
  const result = service.diagnostics(input.uri);
  if (result.kind !== "diagnostics" || !service.isCurrent(result))
    throw Error("Direct service not current");
  const index = createUtf16LineIndex(text);
  return result.diagnostics.map(({ code, source }) => ({
    code,
    range: source
      ? { start: index.offsetAt(source.range.start), end: index.offsetAt(source.range.end) }
      : { start: 0, end: 0 },
  }));
}

for (const [text, status, expected] of [
  ["price + 1", "supported", []],
  [
    "unknown",
    "invalid",
    [{ code: "KALADA_SYNTAX_UNKNOWN_REFERENCE", range: { start: 0, end: 7 } }],
  ],
  ["1 +", "invalid", [{ code: "KALADA_SYNTAX_EXPECTED_EXPRESSION", range: { start: 3, end: 3 } }]],
  ['"😀" - 1\r\n', "invalid", [{ code: "KALADA_OPERATOR_TYPE", range: { start: 0, end: 4 } }]],
]) {
  const current = { ...input, text };
  const result = router.diagnose("expressions", current);
  if (
    result.status !== status ||
    result.document === current ||
    result.document.version !== current.version ||
    result.document.environmentGeneration !== current.environmentGeneration
  )
    throw Error(`Snapshot/status mismatch: ${text}`);
  if (JSON.stringify(result.diagnostics) !== JSON.stringify(expected))
    throw Error(`Fixed diagnostic code/UTF-16 range mismatch: ${text}`);
  if (JSON.stringify(result.diagnostics) !== JSON.stringify(oracle(text)))
    throw Error(`Direct LS parity failed: ${text}`);
}
for (const provider of [
  createExpressionsDiagnosticProvider(() => undefined),
  createExpressionsDiagnosticProvider(() => environments.get("types-v1")),
]) {
  const result = createDiagnosticRouter([domain, provider]).diagnose("expressions", {
    ...input,
    environmentGeneration: "missing",
  });
  if (result.diagnostics[0]?.code !== "EXPRESSIONS_ENVIRONMENT_UNAVAILABLE")
    throw Error("Missing/mismatched environment accepted");
}
if (
  router.diagnose("expressions", { ...input, text: "x".repeat(100_001) }).diagnostics[0]?.code !==
  "PROVIDER_SOURCE_LIMIT"
)
  throw Error("Bound failed");
if (
  createDiagnosticRouter([
    createExpressionsDiagnosticProvider(() => {
      throw Error("secret");
    }),
  ]).diagnose("expressions", input).diagnostics[0]?.code !== "PROVIDER_FAILURE"
)
  throw Error("Failure not bounded");
for (const action of [
  () => createDiagnosticRouter([expressions, expressions]),
  () => router.diagnose("unknown", input),
]) {
  try {
    action();
    throw Error("Missing rejection");
  } catch (error) {
    if (error.message === "Missing rejection") throw error;
  }
}
if (
  router.diagnose("domain", { ...input, environmentGeneration: "names-v1", text: "use alpha" })
    .status !== "supported"
)
  throw Error("Domain registration changed");

import { normalizeManualEnvironment } from "@kalada/host";
import { createExpressionsDiagnosticProvider } from "@kalada/language-service";
import { createDiagnosticRouter } from "@kalada/provider-routing";

globalThis.packedRouterBrowserSmoke = () => {
  const description = normalizeManualEnvironment({ mode: "sync", bindings: [] });
  const expressions = createExpressionsDiagnosticProvider((environmentGeneration) => ({
    environmentGeneration,
    description,
  }));
  const router = createDiagnosticRouter([expressions]);
  return router.diagnose("expressions", {
    uri: "browser",
    text: "1 + 2",
    version: 1,
    environmentGeneration: "v1",
  });
};

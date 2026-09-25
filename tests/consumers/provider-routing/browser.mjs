import { createDiagnosticRouter } from "@kalada/provider-routing";
import { domain } from "./domain.mjs";

globalThis.packedRouterBrowserSmoke = () => {
  const router = createDiagnosticRouter([domain]);
  return router.diagnose("domain", {
    uri: "browser",
    text: "use alpha",
    version: 1,
    environmentGeneration: "names-v2",
  });
};

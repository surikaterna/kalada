import { createDiagnosticRouter } from "@kalada/provider-routing";

export const domain = {
  languageId: "domain",
  diagnose(document) {
    const allowed = {
      "names-v1": ["alpha", "beta"],
      "names-v2": ["beta", "gamma"],
    }[document.environmentGeneration];
    if (!allowed) return { status: "unsupported" };
    const match = /(?<=\buse )[^\s]+/u.exec(document.text);
    if (!match) return { status: "supported", diagnostics: [] };
    if (allowed.includes(match[0])) return { status: "supported", diagnostics: [] };
    return {
      status: "invalid",
      diagnostics: [
        {
          code: "DOMAIN_UNKNOWN_NAME",
          range: { start: match.index, end: match.index + match[0].length },
        },
      ],
    };
  },
};

export function checkDomain(router = createDiagnosticRouter([domain])) {
  const input = {
    uri: "file:///domain",
    text: "🚀\r\nuse absent",
    version: 7,
    environmentGeneration: "names-v1",
  };
  const result = router.diagnose("domain", input);
  if (
    result.status !== "invalid" ||
    JSON.stringify(result.diagnostics) !==
      JSON.stringify([{ code: "DOMAIN_UNKNOWN_NAME", range: { start: 8, end: 14 } }])
  )
    throw new Error("Domain semantic rule or UTF-16 offsets failed");
  if (
    result.document === input ||
    result.document.uri !== input.uri ||
    result.document.version !== 7
  )
    throw new Error("Snapshot identity failed");
  if (router.diagnose("domain", { ...input, text: "use alpha" }).status !== "supported")
    throw new Error("Allowed name failed");
  const changed = { ...input, text: "use alpha", environmentGeneration: "names-v2" };
  const invalid = router.diagnose("domain", changed);
  if (
    invalid.status !== "invalid" ||
    JSON.stringify(invalid.diagnostics) !==
      JSON.stringify([{ code: "DOMAIN_UNKNOWN_NAME", range: { start: 4, end: 9 } }]) ||
    router.diagnose("domain", { ...changed, text: "use gamma" }).status !== "supported" ||
    router.diagnose("domain", { ...changed, text: "use gamma", environmentGeneration: "names-v1" })
      .status !== "invalid"
  )
    throw new Error("Generation-specific domain rule failed");
  if (
    router.diagnose("domain", { ...input, environmentGeneration: "names-v3" }).status !==
    "unsupported"
  )
    throw new Error("Unsupported environment failed");
  return result;
}

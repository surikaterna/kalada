const { createDiagnosticRouter } = require("@kalada/provider-routing");
const input = {
  uri: "file:///domain",
  text: "🚀\r\nuse absent",
  version: 7,
  environmentGeneration: "names-v1",
};
const domain = {
  languageId: "domain",
  diagnose: (document) => {
    if (document.environmentGeneration !== "names-v1") return { status: "unsupported" };
    const match = /(?<=\buse )[^\s]+/u.exec(document.text);
    return match && !["alpha", "beta"].includes(match[0])
      ? {
          status: "invalid",
          diagnostics: [
            {
              code: "DOMAIN_UNKNOWN_NAME",
              range: { start: match.index, end: match.index + match[0].length },
            },
          ],
        }
      : { status: "supported", diagnostics: [] };
  },
};
const result = createDiagnosticRouter([domain]).diagnose("domain", input);
if (result.diagnostics[0]?.range.start !== 8 || result.diagnostics[0]?.range.end !== 14)
  throw new Error("CJS domain semantics failed");

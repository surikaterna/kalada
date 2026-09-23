import {
  createDiagnosticRouter,
  type DiagnosticProvider,
} from "@kalada/provider-routing-prototype";
import { parseKaladaV1Expression } from "@kalada/syntax";
import { describe, expect, it } from "vitest";

// Test-local opt-in adapter. Syntax is consumed only via its public entry point.
const expressions: DiagnosticProvider = {
  languageId: "expressions",
  diagnose(document) {
    const parsed = parseKaladaV1Expression(document.text);
    if (parsed.diagnostics.length === 0) return { status: "supported", diagnostics: [] };
    return {
      status: "invalid",
      diagnostics: parsed.diagnostics.map(({ code, range }) => ({ code, range })),
    };
  },
};

describe("explicit Expressions adapter", () => {
  it("uses the same routing and snapshot path as an independent provider", () => {
    const router = createDiagnosticRouter([expressions]);
    const document = {
      uri: "file:///expr.kalada",
      text: "1 +",
      version: 4,
      environmentGeneration: "types-1",
    };
    const result = router.diagnose("expressions", document);
    expect(result.status).toBe("invalid");
    expect(result.document).toEqual(document);
    expect(result.diagnostics).toEqual(
      parseKaladaV1Expression(document.text).diagnostics.map(({ code, range }) => ({
        code,
        range,
      })),
    );
    expect(
      router.diagnose("expressions", {
        ...document,
        text: "1 + 2",
        environmentGeneration: "types-2",
      }),
    ).toMatchObject({ status: "supported", document: { environmentGeneration: "types-2" } });
  });
});

import { normalizeManualEnvironment } from "@kalada/host";
import {
  createExpressionsDiagnosticProvider,
  createLanguageService,
  createUtf16LineIndex,
} from "@kalada/language-service";
import { createDiagnosticRouter, type DiagnosticProvider } from "@kalada/provider-routing";
import { describe, expect, it } from "vitest";
import {
  invalidEnvironment,
  validEnvironment,
} from "../packages/language-service/src/test-support.js";

const environments = new Map([
  ["types-1", { environmentGeneration: "types-1", description: validEnvironment() }],
  ["types-2", { environmentGeneration: "types-2", description: invalidEnvironment() }],
]);
const expressions = createExpressionsDiagnosticProvider((generation) =>
  environments.get(generation),
);
const document = {
  uri: "file:///expr.kalada",
  text: "price + 1",
  version: 4,
  environmentGeneration: "types-1",
};

function fullDiagnostics(text: string, description = validEnvironment()) {
  // The existing full-service fixture is the parity oracle, not the syntax parser.
  const service = createLanguageService({ generation: 0, description });
  service.openDocument({ uri: document.uri, version: document.version, text });
  const result = service.diagnostics(document.uri);
  if (result.kind !== "diagnostics") throw new Error("Unexpected cancellation");
  const index = createUtf16LineIndex(text);
  return result.diagnostics.map(({ code, phase, source }) => ({
    code,
    phase,
    range: source
      ? { start: index.offsetAt(source.range.start), end: index.offsetAt(source.range.end) }
      : { start: 0, end: 0 },
  }));
}

describe("public Expressions diagnostic provider", () => {
  it.each([
    ["price + 1", []],
    ["1 +", ["parse"]],
    ['"x" - 1', ["lower"]],
    ["unknown", ["lower"]],
    ['"😀" - 1\r\n', ["lower"]],
    ["😀\r\nprice +", ["parse", "parse", "parse", "parse"]],
  ])("matches ordered full-service codes and offsets for %s", (text, phases) => {
    const routed = createDiagnosticRouter([expressions]).diagnose("expressions", {
      ...document,
      text,
    });
    const expected = fullDiagnostics(text);
    expect(expected.map(({ phase }) => phase)).toEqual(phases);
    expect(routed.document).toEqual({ ...document, text });
    expect(routed.diagnostics).toEqual(expected.map(({ code, range }) => ({ code, range })));
    expect(routed.status).toBe(expected.length ? "invalid" : "supported");
  });

  it("resolves the environment for every snapshot and fails closed on absent or mismatched revisions", () => {
    const router = createDiagnosticRouter([expressions]);
    expect(router.diagnose("expressions", document).status).toBe("supported");
    const changed = { ...document, environmentGeneration: "types-2" };
    expect(router.diagnose("expressions", changed).diagnostics).toEqual(
      fullDiagnostics(changed.text, environments.get("types-2")?.description).map(
        ({ code, range }) => ({ code, range }),
      ),
    );
    expect(fullDiagnostics(changed.text, environments.get("types-2")?.description)[0]?.phase).toBe(
      "environment",
    );
    for (const generation of ["missing", "mismatch"]) {
      const provider = createExpressionsDiagnosticProvider(() =>
        generation === "mismatch" ? environments.get("types-1") : undefined,
      );
      expect(
        createDiagnosticRouter([provider]).diagnose("expressions", changed).diagnostics,
      ).toEqual([{ code: "EXPRESSIONS_ENVIRONMENT_UNAVAILABLE", range: { start: 0, end: 0 } }]);
    }
  });

  it("projects unranged link evidence as unknown location without running capabilities", () => {
    const description = normalizeManualEnvironment({ mode: "async", bindings: [] });
    const provider = createExpressionsDiagnosticProvider((environmentGeneration) => ({
      environmentGeneration,
      description,
    }));
    const routed = createDiagnosticRouter([provider]).diagnose("expressions", {
      ...document,
      text: "1",
    });
    expect(fullDiagnostics("1", description).map(({ phase }) => phase)).toEqual(["link"]);
    expect(routed.diagnostics).toEqual([
      { code: "HOST_LINK_ASYNC_UNSUPPORTED", range: { start: 0, end: 0 } },
    ]);
  });

  it("shares the router with a domain provider without changing routing or requiring registration", () => {
    const domain: DiagnosticProvider = {
      languageId: "domain",
      diagnose: () => ({
        status: "invalid",
        diagnostics: [{ code: "DOMAIN_ERROR", range: { start: 0, end: 0 } }],
      }),
    };
    const alone = createDiagnosticRouter([domain]);
    expect(alone.diagnose("domain", document).diagnostics?.[0]?.code).toBe("DOMAIN_ERROR");
    expect(() => alone.diagnose("expressions", document)).toThrow("Unknown language ID");
    const together = createDiagnosticRouter([domain, expressions]);
    expect(together.diagnose("domain", document)).toEqual(alone.diagnose("domain", document));
    expect(together.diagnose("expressions", document).status).toBe("supported");
  });

  it("delegates bounds and thrown resolver failures to the router", () => {
    const router = createDiagnosticRouter([expressions]);
    expect(
      router.diagnose("expressions", { ...document, text: "x".repeat(100_001) }).diagnostics,
    ).toEqual([{ code: "PROVIDER_SOURCE_LIMIT", range: { start: 0, end: 0 } }]);
    expect(
      createDiagnosticRouter([
        createExpressionsDiagnosticProvider(() => {
          throw new Error("secret");
        }),
      ]).diagnose("expressions", document).diagnostics,
    ).toEqual([{ code: "PROVIDER_FAILURE", range: { start: 0, end: 0 } }]);
  });
});

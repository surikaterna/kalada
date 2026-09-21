import type { HostDiagnostic } from "@kalada/host";
import { describe, expect, it, vi } from "vitest";

const trace = vi.hoisted((): { compile?: HostDiagnostic; link?: HostDiagnostic } => ({}));

vi.mock("@kalada/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kalada/host")>();
  return {
    ...actual,
    compileExpression(...input: Parameters<typeof actual.compileExpression>) {
      const result = actual.compileExpression(...input);
      if (!result.ok) trace.compile = result.diagnostics[0];
      return result;
    },
    linkExpression(...input: Parameters<typeof actual.linkExpression>) {
      const result = actual.linkExpression(...input);
      if (!result.ok) trace.link = result.diagnostics[0];
      return result;
    },
  };
});

import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "./index.js";

describe("host diagnostic identity", () => {
  it("retains exact compile diagnostics and frozen lower-level causes", () => {
    const result = analyze('"x" - 1', normalizeManualEnvironment({ mode: "sync", bindings: [] }));
    const problem = result.diagnostics[0];
    expect(problem).toBe(trace.compile);
    expect(problem?.cause).toBe(trace.compile?.cause);
    expect(Object.isFrozen(problem?.cause)).toBe(true);
  });

  it("retains exact link diagnostics", () => {
    const result = analyze("1", normalizeManualEnvironment({ mode: "async", bindings: [] }));
    expect(result.diagnostics[0]).toBe(trace.link);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
  });
});

function analyze(source: string, description: ReturnType<typeof normalizeManualEnvironment>) {
  const service = createLanguageService({ generation: 0, description });
  service.openDocument({ uri: "doc", version: 1, text: source });
  const result = service.analyze("doc");
  if (result.kind !== "analysis") throw new Error("Unexpected cancellation");
  return result;
}

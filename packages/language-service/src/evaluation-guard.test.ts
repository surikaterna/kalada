import { describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => ({ coreEvaluate: 0 }));

vi.mock("@kalada/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kalada/core")>();
  const compile = actual.compileKaladaV1Program;
  return {
    ...actual,
    compileKaladaV1Program(
      input: unknown,
      options?: Parameters<typeof compile>[1],
    ): ReturnType<typeof compile> {
      const result = compile(input, options);
      if (!result.ok) return result;
      const compiled = result.value;
      return Object.freeze({
        ok: true,
        value: Object.freeze({
          ...compiled,
          evaluate(
            resolve: Parameters<typeof compiled.evaluate>[0],
            inputs?: Parameters<typeof compiled.evaluate>[1],
          ) {
            trace.coreEvaluate += 1;
            return compiled.evaluate(resolve, inputs);
          },
          evaluateWithClock(
            resolve: Parameters<typeof compiled.evaluateWithClock>[0],
            clock: Parameters<typeof compiled.evaluateWithClock>[1],
          ) {
            trace.coreEvaluate += 1;
            return compiled.evaluateWithClock(resolve, clock);
          },
        }),
      });
    },
  };
});

import { normalizeManualEnvironment } from "@kalada/host";
import { createLanguageService } from "./index.js";

describe("evaluation guard", () => {
  it("never invokes a core evaluator during analysis or diagnostics", () => {
    trace.coreEvaluate = 0;
    const description = normalizeManualEnvironment({ mode: "sync", bindings: [] });
    const service = createLanguageService({ generation: 0, description });
    service.openDocument({ uri: "doc", version: 1, text: "1 / 0" });
    const analysis = service.analyze("doc");
    const diagnostics = service.diagnostics("doc");
    expect(analysis.kind === "analysis" ? analysis.diagnostics : []).toEqual([]);
    expect(diagnostics.kind === "diagnostics" ? diagnostics.diagnostics : []).toEqual([]);
    expect(trace.coreEvaluate).toBe(0);
  });
});

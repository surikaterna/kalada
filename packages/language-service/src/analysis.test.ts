import { describe, expect, it } from "vitest";
import { createLanguageService, type LanguageService } from "./index.js";
import { invalidEnvironment, validEnvironment } from "./test-support.js";

describe("analysis and diagnostics", () => {
  it("shares phase behavior and preserves exact frozen lower-level causes", () => {
    const service = withDocument('"x" - 1');
    const analysis = service.analyze("doc");
    const diagnostics = service.diagnostics("doc");
    expect(analysis.kind).toBe("analysis");
    expect(diagnostics.kind).toBe("diagnostics");
    if (analysis.kind !== "analysis" || diagnostics.kind !== "diagnostics") return;
    expect(analysis.diagnostics.map(({ code, phase }) => ({ code, phase }))).toEqual(
      diagnostics.diagnostics.map(({ code, phase }) => ({ code, phase })),
    );
    const [problem] = analysis.diagnostics;
    expect(problem?.code).toBe("KALADA_OPERATOR_TYPE");
    expect(problem?.phase).toBe("lower");
    expect(Object.isFrozen(problem?.cause)).toBe(true);
    expect(problem?.cause && "code" in problem.cause ? problem.cause.code : null).toBe(
      problem?.code,
    );
  });

  it("aggregates environment then parse diagnostics with source ranges", () => {
    const description = invalidEnvironment();
    if (description.ok) throw new Error("Expected invalid environment fixture");
    const service = createLanguageService({ generation: 3, description });
    service.openDocument({ uri: "doc", version: 8, text: "😀 +" });
    const result = service.analyze("doc");
    if (result.kind !== "analysis") throw new Error("Unexpected cancellation");
    expect(result.diagnostics[0]).toBe(description.diagnostics[0]);
    expect(result.diagnostics[0]?.provenance).toEqual({
      providerId: "fixture-provider",
      providerVersion: "1",
    });
    expect(result.diagnostics[0]?.phase).toBe("environment");
    expect(result.diagnostics.slice(1).every(({ phase }) => phase === "parse")).toBe(true);
    expect(result.diagnostics[1]?.source).toEqual({
      uri: "doc",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    });
    expect(Object.isFrozen(result.diagnostics[1]?.cause)).toBe(true);
  });

  it("returns successful public syntax artifacts as the future link boundary", () => {
    const service = withDocument("price + 1");
    const result = service.analyze("doc");
    if (result.kind !== "analysis") throw new Error("Unexpected cancellation");
    expect(result.diagnostics).toEqual([]);
    const environment = service.getEnvironment().description;
    if (!environment.ok) throw new Error("Expected valid environment fixture");
    expect(result.analysis.environment).toBe(environment.environment);
    expect(result.analysis.program?.expression).toMatchObject({ kind: "numeric-binary" });
    expect(result.analysis.sourceMap?.length).toBeGreaterThan(0);
    expect(Object.isFrozen(result.analysis)).toBe(true);
  });

  it("labels document and environment races stale and requires the final guard", () => {
    const service = withDocument("1 + 2");
    let calls = 0;
    const result = service.analyze("doc", {
      cancellation: {
        isCancellationRequested: () => {
          calls += 1;
          if (calls === 2) service.updateDocument({ uri: "doc", version: 2, edits: [] });
          return false;
        },
      },
    });
    expect(result.status).toBe("stale");
    expect(result.version).toBe(1);
    expect(result.environmentGeneration).toBe(0);
    expect(service.isCurrent(result)).toBe(false);
    const current = service.diagnostics("doc");
    expect(service.isCurrent(current)).toBe(true);
    service.updateEnvironment({ generation: 1, description: validEnvironment() });
    expect(service.isCurrent(current)).toBe(false);

    const environmentRace = service.analyze("doc", {
      cancellation: {
        isCancellationRequested: (() => {
          let changed = false;
          return () => {
            if (!changed) {
              changed = true;
              service.updateEnvironment({ generation: 2, description: validEnvironment() });
            }
            return false;
          };
        })(),
      },
    });
    expect(environmentRace.status).toBe("stale");
    expect(environmentRace.environmentGeneration).toBe(1);
    expect(service.isCurrent(environmentRace)).toBe(false);
  });

  it("cancels at every deterministic analysis checkpoint without diagnostics or mutation", () => {
    const checkpoints = ["captured", "environment", "parsed", "lowered", "complete"] as const;
    for (const [target, checkpoint] of checkpoints.entries()) {
      const service = withDocument("price + 1");
      const before = service.getDocument("doc");
      let calls = 0;
      const result = service.analyze("doc", {
        cancellation: { isCancellationRequested: () => calls++ === target },
      });
      expect(result).toMatchObject({ kind: "cancelled", operation: "analyze", checkpoint });
      expect("diagnostics" in result).toBe(false);
      expect(service.getDocument("doc")).toBe(before);
    }
  });

  it("does not infer cross-file references and isolates document updates", () => {
    const service = createLanguageService({ generation: 0, description: validEnvironment() });
    service.openDocument({ uri: "declaration.kalada", version: 1, text: "42" });
    service.openDocument({ uri: "consumer.kalada", version: 1, text: "declaration" });
    const result = service.diagnostics("consumer.kalada");
    if (result.kind !== "diagnostics") throw new Error("Unexpected cancellation");
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["KALADA_SYNTAX_UNKNOWN_REFERENCE"]);
    service.updateDocument({ uri: "declaration.kalada", version: 2, edits: [] });
    expect(service.getDocument("consumer.kalada")?.version).toBe(1);
  });
});

function withDocument(text: string): LanguageService {
  const service = createLanguageService({ generation: 0, description: validEnvironment() });
  service.openDocument({ uri: "doc", version: 1, text });
  return service;
}

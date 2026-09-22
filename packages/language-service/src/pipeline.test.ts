import {
  type DescribeEnvironmentResult,
  type HostCompileProjection,
  type ManualProviderInput,
  type NormalizedEnvironment,
  normalizeManualEnvironment,
} from "@kalada/host";
import { describe, expect, it } from "vitest";
import { createLanguageService } from "./index.js";

const numberType = Object.freeze({ kind: "primitive-type" as const, name: "number" as const });

describe("host compile and link integration", () => {
  it("returns safe successful artifacts without evaluating core or capabilities", () => {
    let capabilityCalls = 0;
    const description = described({
      bindings: [binding("value", "validator")],
      capabilities: [validator("validator", "sync", () => (capabilityCalls += 1))],
    });
    const service = serviceFor("value + 1", description);
    const result = service.analyze("doc");
    if (result.kind !== "analysis") throw new Error("Unexpected cancellation");
    expect(result.diagnostics).toEqual([]);
    expect(result.analysis.syntax?.document.source).toBe("value + 1");
    expect(result.analysis.program?.expression).toMatchObject({ kind: "numeric-binary" });
    expect(result.analysis.sourceMap?.length).toBeGreaterThan(0);
    expect(capabilityCalls).toBe(0);
    expect(deepKeys(result.analysis)).not.toContain("evaluate");

    const runtimeFailure = serviceFor("1 / 0", described({ bindings: [] })).diagnostics("doc");
    if (runtimeFailure.kind !== "diagnostics") throw new Error("Unexpected cancellation");
    expect(runtimeFailure.diagnostics).toEqual([]);
  });

  it("reports async provider and capability links without invoking callbacks", () => {
    let calls = 0;
    const asyncProvider = serviceFor("1", described({ mode: "async", bindings: [] })).diagnostics(
      "doc",
    );
    expect(codes(asyncProvider)).toEqual([["link", "HOST_LINK_ASYNC_UNSUPPORTED"]]);

    const asyncCapability = serviceFor(
      "value",
      described({
        bindings: [binding("value", "async-validator")],
        capabilities: [validator("async-validator", "async", () => (calls += 1))],
      }),
    ).diagnostics("doc");
    expect(codes(asyncCapability)).toEqual([["link", "HOST_LINK_ASYNC_UNSUPPORTED"]]);
    expect(calls).toBe(0);
  });

  it("reports missing and invalid capabilities at their exact phase", () => {
    const missing = normalizeManualEnvironment({
      mode: "sync",
      bindings: [binding("value", "missing")],
    });
    const missingResult = serviceFor("value", missing).diagnostics("doc");
    expect(codes(missingResult)).toEqual([["environment", "HOST_ENVIRONMENT_UNKNOWN_CAPABILITY"]]);
    if (!missing.ok && missingResult.kind === "diagnostics") {
      expect(missingResult.diagnostics[0]).toBe(missing.diagnostics[0]);
    }

    const expected = described({
      bindings: [binding("value", "validator")],
      capabilities: [validator("validator", "sync", () => 1)],
    });
    const other = described({ bindings: [] });
    const invalidSnapshot = Object.freeze({
      ok: true as const,
      environment: expected.environment,
      capabilitySnapshot: other.capabilitySnapshot,
    });
    const invalidResult = serviceFor("value", invalidSnapshot).diagnostics("doc");
    expect(codes(invalidResult)).toEqual([["link", "HOST_LINK_INVALID_CAPABILITY"]]);
  });

  it("reports invalid compile projections and incompatible link environments in precedence order", () => {
    const base = described({ bindings: [binding("value")] });
    const invalidProjection = Object.freeze({ format: "invalid", bindings: [] });
    const invalidEnvironment = Object.freeze({
      ...base.environment,
      compileProjection: invalidProjection as unknown as HostCompileProjection,
    });
    const invalid = descriptionFor(invalidEnvironment, base);
    expect(codes(serviceFor("value", invalid).diagnostics("doc"))).toEqual([
      ["compile", "HOST_COMPILE_INVALID_PROJECTION"],
    ]);

    let projectionReads = 0;
    const changedProjection: HostCompileProjection = Object.freeze({
      format: "kalada-host-compile-projection-v1",
      bindings: Object.freeze([]),
    });
    const changingEnvironment: NormalizedEnvironment = Object.freeze({
      ...base.environment,
      get compileProjection() {
        projectionReads += 1;
        return projectionReads === 1 ? base.environment.compileProjection : changedProjection;
      },
    });
    const incompatible = descriptionFor(changingEnvironment, base);
    expect(codes(serviceFor("value", incompatible).diagnostics("doc"))).toEqual([
      ["link", "HOST_LINK_INCOMPATIBLE_ENVIRONMENT"],
    ]);
    expect(projectionReads).toBe(3);
  });
});

function described(
  overrides: Partial<ManualProviderInput>,
): Extract<DescribeEnvironmentResult, { ok: true }> {
  const result = normalizeManualEnvironment({ mode: "sync", bindings: [], ...overrides });
  if (!result.ok) throw new Error(`Invalid test environment: ${result.diagnostics[0]?.code}`);
  return result;
}

function descriptionFor(
  environment: NormalizedEnvironment,
  source: Extract<DescribeEnvironmentResult, { ok: true }>,
): Extract<DescribeEnvironmentResult, { ok: true }> {
  return Object.freeze({ ok: true, environment, capabilitySnapshot: source.capabilitySnapshot });
}

function binding(name: string, validatorHandle?: string) {
  return {
    id: `${name}-id`,
    name,
    path: [name],
    semanticType: numberType,
    ...(validatorHandle ? { validatorHandle } : {}),
  };
}

function validator(handle: string, mode: "sync" | "async", invoked: () => number) {
  return {
    handle,
    kind: "validator" as const,
    mode,
    decode(value: unknown) {
      invoked();
      return value;
    },
  };
}

function serviceFor(source: string, description: DescribeEnvironmentResult) {
  const service = createLanguageService({ generation: 0, description });
  service.openDocument({ uri: "doc", version: 1, text: source });
  return service;
}

function codes(result: ReturnType<ReturnType<typeof serviceFor>["diagnostics"]>) {
  if (result.kind !== "diagnostics") throw new Error("Unexpected cancellation");
  return result.diagnostics.map(({ phase, code }) => [phase, code]);
}

function deepKeys(input: unknown, seen = new Set<object>()): string[] {
  if ((typeof input !== "object" && typeof input !== "function") || input === null) return [];
  if (seen.has(input)) return [];
  seen.add(input);
  const keys = Reflect.ownKeys(input).filter((key): key is string => typeof key === "string");
  return [...keys, ...keys.flatMap((key) => deepKeys(Reflect.get(input, key), seen))];
}

import { describe, expect, it } from "vitest";
import { createDiagnosticRouter, type DiagnosticProvider } from "./index.js";

const domain: DiagnosticProvider = {
  languageId: "domain",
  diagnose(document) {
    const offset = document.text.indexOf("🚀");
    if (offset < 0) return { status: "unsupported" };
    return {
      status: "invalid",
      diagnostics: [{ code: "DOMAIN_MARKER", range: { start: offset, end: offset + 2 } }],
    };
  },
};

const snapshot = {
  uri: "file:///sample.domain",
  text: "a\r\n🚀x",
  version: 1,
  environmentGeneration: "schema-1",
};

describe("independent domain routing", () => {
  it("routes without Expressions and uses half-open UTF-16 offsets", () => {
    const router = createDiagnosticRouter([domain]);
    const first = router.diagnose("domain", snapshot);
    expect(first).toEqual({
      status: "invalid",
      languageId: "domain",
      document: snapshot,
      diagnostics: [{ code: "DOMAIN_MARKER", range: { start: 3, end: 5 } }],
    });
    expect(Object.isFrozen(first.document)).toBe(true);
    expect(Object.isFrozen(first.diagnostics)).toBe(true);
    expect(
      router.diagnose("domain", { ...snapshot, environmentGeneration: "schema-2" }).document,
    ).toEqual({ ...snapshot, environmentGeneration: "schema-2" });
    expect(first.document.environmentGeneration).toBe("schema-1");
    expect(router.diagnose("domain", { ...snapshot, text: "plain" }).status).toBe("unsupported");
  });

  it("captures identity exactly once and leaves stale outcomes identifiable", () => {
    let reads = 0;
    const input = {
      ...snapshot,
      get environmentGeneration() {
        return ++reads === 1 ? "schema-1" : "schema-2";
      },
    };
    const result = createDiagnosticRouter([domain]).diagnose("domain", input);
    expect(reads).toBe(1);
    expect(result.document.environmentGeneration).toBe("schema-1");
    expect(result.document.environmentGeneration).not.toBe(input.environmentGeneration);
    expect(() =>
      createDiagnosticRouter([domain]).diagnose("domain", {
        ...snapshot,
        get text(): string {
          throw new Error("untrusted input");
        },
      }),
    ).toThrow("untrusted input");
  });

  it("rejects duplicate registration, implicit selection and invalid identity", () => {
    expect(() => createDiagnosticRouter([domain, domain])).toThrow("Duplicate language ID");
    const router = createDiagnosticRouter([domain]);
    expect(() => router.diagnose("expressions", snapshot)).toThrow("Unknown language ID");
    expect(() => router.diagnose("domain", { ...snapshot, version: -1 })).toThrow();
    expect(() => router.diagnose("domain", { ...snapshot, uri: "x".repeat(2_049) })).toThrow();
  });

  it("registers only the first language ID read and rejects duplicates", () => {
    let reads = 0;
    const shifting: DiagnosticProvider = {
      get languageId() {
        return ++reads === 1 ? "domain" : "unexpected";
      },
      diagnose: () => ({ status: "supported", diagnostics: [] }),
    };
    expect(() => createDiagnosticRouter([shifting, domain])).toThrow("Duplicate language ID");
    expect(reads).toBe(1);

    reads = 0;
    const router = createDiagnosticRouter([shifting, { ...domain, languageId: "other" }]);
    expect(reads).toBe(1);
    expect(router.diagnose("domain", snapshot)).toMatchObject({
      status: "supported",
      languageId: "domain",
    });
    expect(router.diagnose("other", snapshot).languageId).toBe("other");
    expect(() => router.diagnose("unexpected", snapshot)).toThrow("Unknown language ID");
    expect(reads).toBe(1);
  });

  it("propagates a throwing language ID getter without registering it", () => {
    let reads = 0;
    const throwing: DiagnosticProvider = {
      get languageId(): string {
        reads++;
        throw new Error("language ID getter failed");
      },
      diagnose: () => ({ status: "supported", diagnostics: [] }),
    };
    expect(() => createDiagnosticRouter([domain, throwing])).toThrow("language ID getter failed");
    expect(reads).toBe(1);
  });

  it("fails closed on thrown, malformed and excessive provider responses", () => {
    const bad = (diagnose: DiagnosticProvider["diagnose"]) =>
      createDiagnosticRouter([{ languageId: "bad", diagnose }]).diagnose("bad", snapshot);
    expect(
      bad(() => {
        throw new Error("secret");
      }).diagnostics,
    ).toEqual([{ code: "PROVIDER_FAILURE", range: { start: 0, end: 0 } }]);
    for (const range of [
      { start: -1, end: 2 },
      { start: 3, end: 7 },
      { start: 2, end: 1 },
    ]) {
      expect(
        bad(() => ({ status: "invalid", diagnostics: [{ code: "BAD", range }] })).diagnostics,
      ).toEqual([{ code: "PROVIDER_INVALID_RESULT", range: { start: 0, end: 0 } }]);
    }
    expect(
      bad(
        () =>
          ({
            status: "supported",
            diagnostics: [{ code: "BAD", range: { start: 0, end: 0 } }],
          }) as never,
      ).status,
    ).toBe("invalid");
    expect(bad(() => ({ status: "unsupported", diagnostics: [] }) as never).status).toBe("invalid");
    expect(
      bad(() => ({
        status: "invalid",
        diagnostics: Array.from({ length: 101 }, () => ({
          code: "BAD",
          range: { start: 0, end: 0 },
        })),
      })).diagnostics,
    ).toHaveLength(1);
    const router = createDiagnosticRouter([domain]);
    expect(
      router.diagnose("domain", { ...snapshot, text: "x".repeat(100_001) }).diagnostics,
    ).toEqual([{ code: "PROVIDER_SOURCE_LIMIT", range: { start: 0, end: 0 } }]);
  });

  it("validates exactly the diagnostic primitives it freezes", () => {
    let codeReads = 0;
    let rangeReads = 0;
    let startReads = 0;
    let endReads = 0;
    const diagnostic = {
      get code() {
        return ++codeReads === 1 ? "GOOD" : "bad";
      },
      get range() {
        rangeReads++;
        return {
          get start() {
            return ++startReads === 1 ? 3 : -1;
          },
          get end() {
            return ++endReads === 1 ? 5 : 100;
          },
        };
      },
    };
    const router = createDiagnosticRouter([
      {
        languageId: "once",
        diagnose: () => ({ status: "invalid", diagnostics: [diagnostic] }),
      },
    ]);
    const result = router.diagnose("once", snapshot);
    if (result.status === "unsupported") throw new Error("Unexpected unsupported outcome");
    expect(result.diagnostics).toEqual([{ code: "GOOD", range: { start: 3, end: 5 } }]);
    expect([codeReads, rangeReads, startReads, endReads]).toEqual([1, 1, 1, 1]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0]?.range)).toBe(true);
  });

  it("copies a bounded diagnostic length once even when an array proxy changes length", () => {
    const item = { code: "GOOD", range: { start: 3, end: 5 } };
    for (const [status, firstLength, expectedStatus, expectedCode] of [
      ["supported", 1, "invalid", "PROVIDER_INVALID_RESULT"],
      ["invalid", 1, "invalid", "GOOD"],
      ["supported", 0, "supported", undefined],
      ["invalid", 0, "invalid", "PROVIDER_INVALID_RESULT"],
    ] as const) {
      let lengthReads = 0;
      let itemReads = 0;
      const diagnostics = new Proxy([item], {
        get(target, key, receiver) {
          if (key === "length") return ++lengthReads === 1 ? firstLength : 1 - firstLength;
          if (key === "0") itemReads++;
          return Reflect.get(target, key, receiver);
        },
      });
      const result = createDiagnosticRouter([
        { languageId: "dynamic", diagnose: () => ({ status, diagnostics }) },
      ]).diagnose("dynamic", snapshot);
      if (result.status === "unsupported") throw new Error("Unexpected unsupported outcome");
      expect(result.status).toBe(expectedStatus);
      expect(result.diagnostics).toHaveLength(expectedCode ? 1 : 0);
      expect(result.diagnostics[0]?.code).toBe(expectedCode);
      expect([lengthReads, itemReads]).toEqual([1, firstLength]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.diagnostics)).toBe(true);
      if (result.diagnostics[0]) {
        expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
        expect(Object.isFrozen(result.diagnostics[0].range)).toBe(true);
      }
    }
  });

  it("rejects malformed or excessive lengths and fails closed on throwing accessors", () => {
    const route = (diagnostics: unknown) =>
      createDiagnosticRouter([
        {
          languageId: "dynamic",
          diagnose: () => ({ status: "invalid", diagnostics }) as never,
        },
      ]).diagnose("dynamic", snapshot);
    for (const length of [101, -1, 1.5, Number.NaN, Infinity, "1"]) {
      let reads = 0;
      const source = new Proxy([], {
        get(_target, key) {
          if (key === "length") {
            reads++;
            return length;
          }
          throw new Error("unexpected item read");
        },
      });
      expect(route(source).diagnostics?.[0]?.code).toBe("PROVIDER_INVALID_RESULT");
      expect(reads).toBe(1);
    }
    expect(route({ 0: { code: "GOOD" }, length: 1 }).diagnostics?.[0]?.code).toBe(
      "PROVIDER_INVALID_RESULT",
    );
    for (const key of ["length", "0"] as const) {
      const source = new Proxy([{ code: "GOOD", range: { start: 0, end: 0 } }], {
        get(target, property, receiver) {
          if (property === key) throw new Error("secret");
          return Reflect.get(target, property, receiver);
        },
      });
      const result = route(source);
      expect(result.diagnostics?.[0]?.code).toBe("PROVIDER_FAILURE");
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.diagnostics)).toBe(true);
      expect(Object.isFrozen(result.diagnostics?.[0]?.range)).toBe(true);
    }
  });

  it("fails closed on invalid first reads and throwing diagnostic accessors", () => {
    const diagnose = (diagnostic: unknown) =>
      createDiagnosticRouter([
        {
          languageId: "bad",
          diagnose: () => ({ status: "invalid", diagnostics: [diagnostic] }) as never,
        },
      ]).diagnose("bad", snapshot);
    expect(diagnose({ code: "bad", range: { start: 0, end: 0 } }).diagnostics).toEqual([
      { code: "PROVIDER_INVALID_RESULT", range: { start: 0, end: 0 } },
    ]);
    expect(diagnose({ code: "GOOD", range: { start: -1, end: 0 } }).diagnostics).toEqual([
      { code: "PROVIDER_INVALID_RESULT", range: { start: 0, end: 0 } },
    ]);
    expect(
      diagnose({
        get code(): string {
          throw new Error("secret");
        },
      }).diagnostics,
    ).toEqual([{ code: "PROVIDER_FAILURE", range: { start: 0, end: 0 } }]);
  });
});

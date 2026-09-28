import { describe, expect, it } from "vitest";
import { checkKaladaV1DirectLocation } from "../index.js";

const number = { kind: "primitive-type", name: "number" } as const;
const json = { kind: "primitive-type", name: "json" } as const;
const options = {
  bindings: {
    line: {
      target: { namespace: "data", scope: "line", segments: [] },
      type: json,
      writable: true,
      properties: { quantity: { type: number, writable: true } },
    },
    root: { target: { namespace: "data", segments: ["total"] }, type: number, writable: true },
  },
} as const;

describe("static direct WRITE location", () => {
  it("returns detached frozen scoped and absolute typed locations including grouped range", () => {
    const dotted = checkKaladaV1DirectLocation(" (line.quantity) ", options);
    expect(dotted).toMatchObject({
      ok: true,
      location: {
        target: { namespace: "data", scope: "line", segments: ["quantity"] },
        type: number,
        range: { start: 1, end: 16 },
      },
    });
    if (dotted.ok) expect(Object.isFrozen(dotted.location.target.segments)).toBe(true);
    expect(checkKaladaV1DirectLocation("root", options)).toMatchObject({
      ok: true,
      location: { target: { segments: ["total"] }, type: number },
    });
    const nested = checkKaladaV1DirectLocation("line.details.quantity", {
      bindings: {
        line: {
          ...options.bindings.line,
          properties: {
            details: {
              type: json,
              writable: true,
              properties: { quantity: { type: number, writable: true } },
            },
          },
        },
      },
    });
    expect(nested).toMatchObject({
      ok: true,
      location: { target: { segments: ["details", "quantity"] }, type: number },
    });
  });

  it.each([
    "line?.quantity",
    "line[0]",
    "line.0",
    "line.quantity + 1",
    "line.quantity ? root : root",
    "line.quantity extra",
    "line.__proto__",
    "line.quantity.more",
    "(line.quantity",
    "line . quantity ()",
  ])("rejects non-direct or recovered input %s", (source) => {
    const result = checkKaladaV1DirectLocation(source, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.range.end).toBeLessThanOrEqual(source.length);
  });

  it("rejects missing authority and accessor metadata without invoking getters", () => {
    expect(checkKaladaV1DirectLocation("line.quantity", { bindings: {} }).ok).toBe(false);
    expect(
      checkKaladaV1DirectLocation("line", {
        bindings: { line: { ...options.bindings.line, type: "dynamic" as never } },
      }).ok,
    ).toBe(false);
    expect(checkKaladaV1DirectLocation({ document: { expression: {} } } as never, options).ok).toBe(
      false,
    );
    let calls = 0;
    const properties = Object.create(null);
    Object.defineProperty(properties, "quantity", {
      get() {
        calls++;
        throw Error("trap");
      },
    });
    const bindings = { line: { ...options.bindings.line, properties } };
    expect(checkKaladaV1DirectLocation("line.quantity", { bindings }).ok).toBe(false);
    expect(calls).toBe(0);
    const type = Object.defineProperty({ kind: "primitive-type" }, "name", {
      get() {
        calls++;
        throw Error("trap");
      },
    });
    expect(
      checkKaladaV1DirectLocation("root", {
        bindings: { root: { ...options.bindings.root, type: type as never } },
      }).ok,
    ).toBe(false);
    expect(calls).toBe(0);
  });

  it("rejects invalid targets and property authority", () => {
    expect(
      checkKaladaV1DirectLocation("root", {
        bindings: {
          root: {
            ...options.bindings.root,
            target: { namespace: "data", segments: ["constructor"] },
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      checkKaladaV1DirectLocation("line.quantity", {
        bindings: {
          line: {
            ...options.bindings.line,
            target: { namespace: "ui", scope: "line", segments: [] } as never,
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      checkKaladaV1DirectLocation("line.quantity", {
        bindings: {
          line: {
            ...options.bindings.line,
            properties: { quantity: { type: number, writable: false as never } },
          },
        },
      }).ok,
    ).toBe(false);
  });

  it("requires exact, dense, ordinary data arrays for target segments", () => {
    let calls = 0;
    const extra = Object.assign(["total"], { extra: "surprise" });
    const altered = ["total"];
    Object.setPrototypeOf(altered, Object.create(Array.prototype));
    const sparse = new Array<string>(1);
    const accessor = ["total"];
    Object.defineProperty(accessor, "0", {
      get() {
        calls++;
        throw Error("getter trap");
      },
    });
    const iterator = ["total"];
    Object.defineProperty(iterator, Symbol.iterator, {
      value: function* () {
        calls++;
        yield "total";
      },
    });
    const throwing = new Proxy(["total"], {
      ownKeys() {
        throw Error("proxy trap");
      },
    });
    for (const segments of [extra, altered, sparse, accessor, iterator, throwing]) {
      expect(
        checkKaladaV1DirectLocation("root", {
          bindings: { root: { ...options.bindings.root, target: { namespace: "data", segments } } },
        }),
      ).toMatchObject({
        ok: false,
        diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
      });
    }
    expect(calls).toBe(0);
  });

  it("rejects non-data type leaves without executing coercion", () => {
    let calls = 0;
    const maliciousName = {
      toString() {
        calls++;
        return "number";
      },
    };
    for (const name of [maliciousName, () => "number", 1, null]) {
      const result = checkKaladaV1DirectLocation("root", {
        bindings: {
          root: { ...options.bindings.root, type: { kind: "primitive-type", name } as never },
        },
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
      });
    }
    expect(calls).toBe(0);
    const valid = checkKaladaV1DirectLocation("root", options);
    expect(valid).toMatchObject({ ok: true, location: { type: number } });
    if (valid.ok && valid.location.type.kind === "primitive-type") {
      expect(typeof valid.location.type.name).toBe("string");
    }
  });

  it("rejects inherited and own iterator traps on function parameters without invoking them", () => {
    let calls = 0;
    const parameters = [number];
    const inherited = Object.create(Array.prototype);
    Object.defineProperty(inherited, Symbol.iterator, {
      get() {
        calls++;
        throw Error("iterator trap");
      },
    });
    Object.setPrototypeOf(parameters, inherited);
    const functionType = { kind: "function-type", parameters, returns: number } as const;
    const check = () =>
      checkKaladaV1DirectLocation("root", {
        bindings: { root: { ...options.bindings.root, type: functionType } },
      });
    expect(check()).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
    });
    Object.setPrototypeOf(parameters, Array.prototype);
    Object.defineProperty(parameters, Symbol.iterator, {
      value: function* () {
        calls++;
        yield json;
      },
    });
    expect(check()).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
    });
    expect(calls).toBe(0);
  });

  it("rejects cyclic, throwing-proxy, and malformed nested parameter types", () => {
    const cyclic: { kind: string; value?: unknown } = { kind: "option-type" };
    cyclic.value = cyclic;
    const throwing = new Proxy(
      { kind: "primitive-type", name: "number" },
      {
        ownKeys() {
          throw Error("proxy trap");
        },
      },
    );
    for (const parameter of [cyclic, throwing, { kind: "unsupported-type" }]) {
      expect(
        checkKaladaV1DirectLocation("root", {
          bindings: {
            root: {
              ...options.bindings.root,
              type: { kind: "function-type", parameters: [parameter], returns: number } as never,
            },
          },
        }),
      ).toMatchObject({
        ok: false,
        diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
      });
    }
  });

  it("accepts shared acyclic type metadata but rejects cycles and excessive depth", () => {
    const shared = { kind: "result-type", ok: number, error: number } as const;
    const separate = {
      kind: "result-type",
      ok: { kind: "primitive-type", name: "number" },
      error: { kind: "primitive-type", name: "number" },
    } as const;
    const check = (type: unknown) =>
      checkKaladaV1DirectLocation("root", {
        bindings: { root: { ...options.bindings.root, type: type as never } },
      });
    const accepted = check(shared);
    const equivalent = check(separate);
    expect(accepted).toMatchObject({ ok: true, location: { type: separate } });
    expect(accepted).toEqual(equivalent);
    if (accepted.ok && accepted.location.type.kind === "result-type") {
      expect(accepted.location.type).not.toBe(shared);
      expect(accepted.location.type.ok).not.toBe(number);
      expect(Object.isFrozen(accepted.location.type.ok)).toBe(true);
      expect(Object.isFrozen(accepted.location.target.segments)).toBe(true);
    }

    const cyclic: { kind: string; ok?: unknown; error: typeof number } = {
      kind: "result-type",
      error: number,
    };
    cyclic.ok = cyclic;
    expect(check(cyclic)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
    });

    let deep: unknown = number;
    for (let i = 0; i < 256; i++) deep = { kind: "option-type", value: deep };
    expect(check(deep)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "KALADA_SYNTAX_WRITE_BINDING_INVALID" }],
    });
  });

  it("accepts valid function and nested collection types with detached frozen output", () => {
    const parameters = [{ kind: "array-type", element: number } as const];
    const type = { kind: "function-type", parameters, returns: json } as const;
    const result = checkKaladaV1DirectLocation("root", {
      bindings: { root: { ...options.bindings.root, type } },
    });
    expect(result).toMatchObject({ ok: true, location: { type } });
    if (!result.ok) return;
    parameters[0] = { kind: "array-type", element: number };
    expect(result.location.type).not.toBe(type);
    expect(Object.isFrozen(result.location.type)).toBe(true);
  });
});

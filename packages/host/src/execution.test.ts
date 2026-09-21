import { describe, expect, it } from "vitest";
import {
  compileExpression,
  createManualProvider,
  describeEnvironment,
  evaluateExpression,
  linkExpression,
  type ManualProviderInput,
  type PreparedExpression,
  parseExpression,
  prepareExpression,
} from "./index.js";

const numberType = Object.freeze({ kind: "primitive-type" as const, name: "number" as const });

function provider(overrides: Partial<ManualProviderInput> = {}) {
  return createManualProvider({
    mode: "sync",
    providerId: "test.provider",
    providerVersion: "1",
    configurationDigest: "config-a",
    bindings: [
      { id: "left-id", name: "left", path: ["form", "left"], semanticType: numberType },
      { id: "right-id", name: "right", path: ["form", "right"], semanticType: numberType },
    ],
    ...overrides,
  });
}

function advanced(source: string, input = provider(), sourceUri = "memory:///test.kalada") {
  const described = describeEnvironment(input);
  expect(described.ok).toBe(true);
  if (!described.ok) throw new Error("environment");
  const parsed = parseExpression(source, { sourceUri });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("parse");
  const compiled = compileExpression(parsed.value, described.environment.compileProjection);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) throw new Error("compile");
  const linked = linkExpression(
    compiled.value,
    described.environment,
    described.capabilitySnapshot,
  );
  return { described, parsed, compiled, linked };
}

describe("synchronous prepared execution", () => {
  it("composes equivalent advanced, prepared, and one-shot paths with syntax-owned type", () => {
    const input = provider();
    const explicit = advanced("left + right", input);
    const prepared = prepareExpression("left + right", input, {
      parse: { sourceUri: "memory:///test.kalada" },
    });
    const oneShot = evaluateExpression(
      "left + right",
      input,
      { left: 2, right: 3 },
      {
        parse: { sourceUri: "memory:///test.kalada" },
      },
    );
    expect(explicit.linked).toMatchObject({ ok: true });
    expect(prepared).toMatchObject({ ok: true });
    expect(oneShot).toEqual({ ok: true, value: 5 });
    if (!explicit.linked.ok || !prepared.ok) return;
    expect(explicit.linked.value.evaluate({ left: 2, right: 3 })).toEqual(oneShot);
    expect(prepared.value.evaluate({ left: 2, right: 3 })).toEqual(oneShot);
    expect(prepared.value.compiled.resultType).toEqual(numberType);
    expect(prepared.value.compiled.program).toEqual(explicit.compiled.value.program);
  });

  it("runs preparation once and every value stage for both prepared evaluations", () => {
    const trace = { reads: 0, validates: 0, converts: 0 };
    const input = provider({
      capabilities: [
        {
          handle: "validate",
          kind: "validator",
          mode: "sync",
          capabilityId: "validate",
          capabilityVersion: "1",
          configurationDigest: "a",
          decode(value) {
            trace.validates += 1;
            return value;
          },
        },
        {
          handle: "convert",
          kind: "codec",
          mode: "sync",
          capabilityId: "convert",
          capabilityVersion: "1",
          configurationDigest: "a",
          convert(value) {
            trace.converts += 1;
            return Number(value);
          },
        },
      ],
      bindings: [
        {
          id: "left-id",
          name: "left",
          path: ["form", "left"],
          semanticType: numberType,
          validatorHandle: "validate",
          codecHandle: "convert",
        },
      ],
    });
    const prepared = prepareExpression("left + 1", input);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const values = new Proxy(
      { left: "2" },
      {
        getOwnPropertyDescriptor(target, key) {
          trace.reads += 1;
          return Object.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const compiled = prepared.value.compiled;
    expect(prepared.value.evaluate(values)).toEqual({ ok: true, value: 3 });
    expect(prepared.value.evaluate(values)).toEqual({ ok: true, value: 3 });
    expect(prepared.value.compiled).toBe(compiled);
    expect(trace).toEqual({ reads: 2, validates: 2, converts: 2 });
  });

  it("reads only dependencies once in order and rejects non-data values", () => {
    const prepared = prepareExpression("right + left", provider());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const reads: PropertyKey[] = [];
    const values = new Proxy(
      { left: 1, right: 2, extra: 99 },
      {
        getOwnPropertyDescriptor(target, key) {
          reads.push(key);
          return Object.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(prepared.value.evaluate(values)).toEqual({ ok: true, value: 3 });
    expect(reads).toEqual(["right", "left"]);
    const inherited = Object.create({ left: 1 }) as Record<string, unknown>;
    inherited.right = 2;
    expect(prepared.value.evaluate(inherited)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_BINDING_MISSING", bindingPath: ["form", "left"] }],
    });
    let accessed = false;
    const accessor = { right: 2 };
    Object.defineProperty(accessor, "left", {
      get() {
        accessed = true;
        return 1;
      },
    });
    expect(prepared.value.evaluate(accessor)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_BINDING_MISSING" }],
    });
    expect(accessed).toBe(false);
  });

  it("rejects async declarations without invoking their callbacks", () => {
    let calls = 0;
    const asyncCapability = provider({
      bindings: [
        {
          id: "left-id",
          name: "left",
          path: ["left"],
          semanticType: numberType,
          validatorHandle: "async-validator",
        },
      ],
      capabilities: [
        {
          handle: "async-validator",
          kind: "validator",
          mode: "async",
          decode() {
            calls += 1;
            return 1;
          },
        },
      ],
    });
    expect(prepareExpression("left", asyncCapability)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_LINK_ASYNC_UNSUPPORTED", phase: "link" }],
    });
    expect(calls).toBe(0);
    expect(prepareExpression("1", provider({ mode: "async", bindings: [] }))).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_LINK_ASYNC_UNSUPPORTED" }],
    });
  });

  it.each(["promise", "own-getter", "inherited-getter"] as const)(
    "rejects validator %s thenables without reading then or entering core",
    (kind) => {
      let thenReads = 0;
      let coreCalls = 0;
      const output = thenable(kind, () => {
        thenReads += 1;
      });
      const input = provider({
        bindings: [
          {
            id: "left-id",
            name: "left",
            path: ["left"],
            semanticType: numberType,
            validatorHandle: "validator",
          },
        ],
        capabilities: [
          { handle: "validator", kind: "validator", mode: "sync", decode: () => output },
        ],
      });
      const result = advanced("left", input);
      expect(result.linked.ok).toBe(true);
      if (!result.linked.ok) return;
      const forged = {
        ...result.compiled.value,
        coreCompilation: {
          ...result.compiled.value.coreCompilation,
          evaluate() {
            coreCalls += 1;
            return { ok: true as const, value: 0 };
          },
        },
      };
      const relinked = linkExpression(
        forged,
        result.described.environment,
        result.described.capabilitySnapshot,
      );
      expect(relinked.ok).toBe(true);
      if (!relinked.ok) return;
      expect(relinked.value.evaluate({ left: 1 })).toMatchObject({
        ok: false,
        diagnostics: [{ code: "HOST_BINDING_DECODE", phase: "bind" }],
      });
      expect({ thenReads, coreCalls }).toEqual({ thenReads: 0, coreCalls: 0 });
    },
  );

  it("applies the same thenable guard and no-core rule to codecs", () => {
    let coreCalls = 0;
    const input = provider({
      bindings: [
        {
          id: "left-id",
          name: "left",
          path: ["left"],
          semanticType: numberType,
          codecHandle: "codec",
        },
      ],
      capabilities: [
        { handle: "codec", kind: "codec", mode: "sync", convert: () => Promise.resolve(1) },
      ],
    });
    const result = advanced("left", input);
    if (!result.linked.ok) return;
    const forged = {
      ...result.compiled.value,
      coreCompilation: {
        ...result.compiled.value.coreCompilation,
        evaluate() {
          coreCalls += 1;
          return { ok: true as const, value: 0 };
        },
      },
    };
    const linked = linkExpression(
      forged,
      result.described.environment,
      result.described.capabilitySnapshot,
    );
    expect(linked.ok && linked.value.evaluate({ left: 1 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_BINDING_CONVERSION" }],
    });
    expect(coreCalls).toBe(0);
  });

  it("maps immutable diagnostics to UTF-16 source and preserves cause identity", () => {
    const parsed = parseExpression("true +\n 1", { sourceUri: "file:///diagnostic.kalada" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const described = describeEnvironment(provider({ bindings: [] }));
    if (!described.ok) return;
    const compiled = compileExpression(parsed.value, described.environment.compileProjection);
    expect(compiled).toMatchObject({
      ok: false,
      diagnostics: [
        {
          phase: "lower",
          source: {
            uri: "file:///diagnostic.kalada",
            range: { start: { line: 0 }, end: { line: 0 } },
          },
        },
      ],
    });
    if (compiled.ok) return;
    const diagnostic = compiled.diagnostics[0];
    expect(diagnostic).toMatchObject({
      code: "KALADA_OPERATOR_TYPE",
      cause: { code: "KALADA_OPERATOR_TYPE", phase: "lower", path: ["expression", "left"] },
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic?.cause)).toBe(true);
    expect(Object.isFrozen(diagnostic?.source?.range)).toBe(true);

    const runtime = prepareExpression("1 / 0", provider({ bindings: [] }), {
      parse: { sourceUri: "file:///evaluate.kalada" },
    });
    expect(runtime.ok).toBe(true);
    if (!runtime.ok) return;
    expect(runtime.value.evaluate({})).toMatchObject({
      ok: false,
      diagnostics: [{ phase: "evaluate", source: { uri: "file:///evaluate.kalada" }, cause: {} }],
    });
  });

  it("sanitizes capability failures and enforces decode-convert-semantic precedence", () => {
    const calls: string[] = [];
    const input = provider({
      bindings: [
        {
          id: "left-id",
          name: "left",
          path: ["safe", "left"],
          semanticType: numberType,
          validatorHandle: "validator",
          codecHandle: "codec",
          provenance: [{ providerId: "safe-provider", source: "schema" }],
        },
      ],
      capabilities: [
        {
          handle: "validator",
          kind: "validator",
          mode: "sync",
          decode() {
            calls.push("decode");
            throw new Error("SECRET");
          },
        },
        {
          handle: "codec",
          kind: "codec",
          mode: "sync",
          convert(value) {
            calls.push("codec");
            return value;
          },
        },
      ],
    });
    const prepared = prepareExpression("left", input);
    if (!prepared.ok) return;
    const outcome = prepared.value.evaluate({ left: "secret-value" });
    expect(outcome).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "HOST_BINDING_DECODE",
          bindingPath: ["safe", "left"],
          provenance: { providerId: "test.provider", providerVersion: "1" },
        },
      ],
    });
    expect(JSON.stringify(outcome)).not.toMatch(/SECRET|secret-value/u);
    expect(calls).toEqual(["decode"]);
  });

  it("is deeply immutable, retains no values, and supports nested reentrant evaluation", () => {
    let prepared: PreparedExpression | undefined;
    let nested: unknown;
    const input = provider({
      bindings: [
        {
          id: "left-id",
          name: "left",
          path: ["left"],
          semanticType: numberType,
          validatorHandle: "validator",
        },
      ],
      capabilities: [
        {
          handle: "validator",
          kind: "validator",
          mode: "sync",
          decode(value) {
            if (value === 2) nested = prepared?.evaluate({ left: 3 });
            return value;
          },
        },
      ],
    });
    const outcome = prepareExpression("left + 1", input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    prepared = outcome.value;
    const runtimeValues = { left: 2 };
    expect(prepared.evaluate(runtimeValues)).toEqual({ ok: true, value: 3 });
    expect(nested).toEqual({ ok: true, value: 4 });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.linkPlan)).toBe(true);
    expect(Object.isFrozen(prepared.compiled)).toBe(true);
    expect(containsIdentity(prepared, runtimeValues)).toBe(false);
  });
});

describe("fingerprints and compatibility", () => {
  it("invalidates compile identity at source, URI, option, profile, and projection boundaries", () => {
    const base = compileFingerprint("left", provider(), "memory:///a", {});
    const matrix = [
      compileFingerprint("left + 1", provider(), "memory:///a", {}),
      compileFingerprint("left", provider(), "memory:///b", {}),
      compileFingerprint("left", provider(), "memory:///a", { profile: "alternate" }),
      compileFingerprint("left", provider(), "memory:///a", {
        limits: { maxEvaluationSteps: 1_000 },
      }),
      compileFingerprint("left", provider(), "memory:///a", {}, 2_000),
      compileFingerprint(
        "left",
        provider({
          bindings: [
            { id: "left-id", name: "left", path: ["form", "left"], semanticType: "dynamic" },
          ],
        }),
        "memory:///a",
        {},
      ),
    ];
    expect(new Set(matrix)).toHaveLength(matrix.length);
    expect(matrix.every((item) => item !== base)).toBe(true);
  });

  it("invalidates reusable links for paths, provider config, and capability config", () => {
    const base = linkFingerprint(cacheableProvider("path-a", "provider-a", "cap-a"));
    const matrix = [
      linkFingerprint(cacheableProvider("path-b", "provider-a", "cap-a")),
      linkFingerprint(cacheableProvider("path-a", "provider-b", "cap-a")),
      linkFingerprint(cacheableProvider("path-a", "provider-a", "cap-b")),
    ];
    expect(base).toBeDefined();
    expect(matrix.every((item) => item !== base)).toBe(true);
    const nonCacheable = prepareExpression("left", provider({ providerId: undefined }));
    expect(nonCacheable.ok && Object.hasOwn(nonCacheable.value, "linkFingerprint")).toBe(false);
  });

  it("rejects stale compile projections and duplicate runtime names", () => {
    const first = advanced("left", provider());
    const changed = describeEnvironment(
      provider({
        bindings: [{ id: "left-id", name: "left", path: ["left"], semanticType: "dynamic" }],
      }),
    );
    if (!changed.ok) return;
    expect(
      linkExpression(first.compiled.value, changed.environment, changed.capabilitySnapshot),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_LINK_INCOMPATIBLE_ENVIRONMENT" }],
    });
    expect(
      describeEnvironment(
        provider({
          bindings: [
            { id: "a", name: "same", path: ["a"], semanticType: "dynamic" },
            { id: "b", name: "same", path: ["b"], semanticType: "dynamic" },
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HOST_ENVIRONMENT_DUPLICATE_BINDING" }],
    });
  });
});

function thenable(kind: "promise" | "own-getter" | "inherited-getter", read: () => void) {
  if (kind === "promise") return Promise.resolve(1);
  const target = kind === "own-getter" ? {} : Object.create({});
  const owner = kind === "own-getter" ? target : Object.getPrototypeOf(target);
  // biome-ignore lint/suspicious/noThenProperty: This fixture verifies hostile thenable rejection.
  Object.defineProperty(owner, "then", {
    get() {
      read();
      throw new Error("hostile then");
    },
  });
  return target;
}

function compileFingerprint(
  source: string,
  input: ReturnType<typeof provider>,
  uri: string,
  options: { profile?: string; limits?: { maxEvaluationSteps: number } },
  maxSourceLength?: number,
) {
  const described = describeEnvironment(input);
  const parsed = parseExpression(source, {
    sourceUri: uri,
    ...(maxSourceLength ? { syntax: { limits: { maxSourceLength } } } : {}),
  });
  if (!described.ok || !parsed.ok) throw new Error("fixture");
  const compiled = compileExpression(
    parsed.value,
    described.environment.compileProjection,
    options,
  );
  if (!compiled.ok) throw new Error("fixture");
  return compiled.value.compileFingerprint;
}

function cacheableProvider(path: string, providerDigest: string, capabilityDigest: string) {
  return provider({
    configurationDigest: providerDigest,
    bindings: [
      {
        id: "left-id",
        name: "left",
        path: [path],
        semanticType: numberType,
        validatorHandle: "validator",
      },
    ],
    capabilities: [
      {
        handle: "validator",
        kind: "validator",
        mode: "sync",
        capabilityId: "validator",
        capabilityVersion: "1",
        configurationDigest: capabilityDigest,
        decode: (value) => value,
      },
    ],
  });
}

function linkFingerprint(input: ReturnType<typeof provider>) {
  const prepared = prepareExpression("left", input);
  if (!prepared.ok) throw new Error("fixture");
  return prepared.value.linkFingerprint;
}

function containsIdentity(input: unknown, target: object, seen = new Set<object>()): boolean {
  if (input === target) return true;
  if ((typeof input !== "object" || input === null) && typeof input !== "function") return false;
  if (seen.has(input as object)) return false;
  seen.add(input as object);
  for (const key of Reflect.ownKeys(input as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor && "value" in descriptor && containsIdentity(descriptor.value, target, seen))
      return true;
  }
  return false;
}

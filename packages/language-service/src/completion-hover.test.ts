import type { EditorShape, ManualProviderInput } from "@kalada/host";
import { normalizeManualEnvironment } from "@kalada/host";
import { describe, expect, it } from "vitest";
import { createLanguageService } from "./index.js";

const scalar = (name: "string" | "number" | "boolean"): EditorShape => ({ kind: "scalar", name });

function object(
  properties: { name: string; required: boolean; shape: EditorShape }[],
): EditorShape {
  return { kind: "object", properties };
}

function fixture(): ManualProviderInput {
  const user = object([
    { name: "name", required: true, shape: scalar("string") },
    { name: "nickname", required: false, shape: scalar("string") },
    {
      name: "details",
      required: true,
      shape: object([{ name: "city", required: true, shape: scalar("string") }]),
    },
    { name: "next", required: false, shape: { kind: "reference", definition: "User" } },
    { name: "items", required: true, shape: { kind: "array", element: scalar("string") } },
    {
      name: "pair",
      required: true,
      shape: { kind: "tuple", items: [scalar("string"), scalar("number")] },
    },
    { name: "a-b", required: true, shape: scalar("number") },
  ]);
  return {
    mode: "sync",
    providerId: "manual.fixture",
    providerVersion: "1",
    configurationDigest: "fixture",
    bindings: [
      {
        id: "user-id",
        name: "user",
        path: ["input", "user"],
        semanticType: { kind: "primitive-type", name: "json" },
        editorShape: {
          root: { kind: "reference", definition: "User" },
          definitions: [{ name: "User", shape: user }],
        },
        provenance: [{ providerId: "manual.fixture", providerVersion: "1", source: "secret" }],
      },
      {
        id: "choice-id",
        name: "choice",
        path: ["input", "choice"],
        semanticType: { kind: "primitive-type", name: "json" },
        editorShape: {
          root: {
            kind: "union",
            variants: [
              object([
                { name: "common", required: true, shape: scalar("string") },
                { name: "left", required: true, shape: scalar("number") },
              ]),
              object([
                { name: "common", required: false, shape: scalar("string") },
                { name: "right", required: true, shape: scalar("number") },
              ]),
              { kind: "unknown", reason: "partial vendor shape" },
            ],
          },
        },
      },
      {
        id: "known-id",
        name: "known",
        path: ["known"],
        semanticType: { kind: "primitive-type", name: "number" },
        editorShape: {
          root: object([{ name: "visibleInput", required: true, shape: scalar("number") }]),
        },
      },
      {
        id: "opt-id",
        name: "opt",
        path: ["opt"],
        semanticType: {
          kind: "option-type",
          value: { kind: "primitive-type", name: "boolean" },
        },
        editorShape: { root: scalar("boolean") },
      },
      {
        id: "viable-id",
        name: "viable",
        path: ["viable"],
        semanticType: { kind: "primitive-type", name: "json" },
        editorShape: {
          root: {
            kind: "union",
            variants: [
              object([{ name: "stable", required: true, shape: scalar("string") }]),
              { kind: "never" },
            ],
          },
        },
      },
      {
        id: "wrapped-id",
        name: "wrapped",
        path: ["wrapped"],
        semanticType: { kind: "primitive-type", name: "json" },
        editorShape: {
          root: {
            kind: "intersection",
            operands: [
              {
                kind: "wrapper",
                wrapper: "readonly",
                inner: object([{ name: "both", required: true, shape: scalar("string") }]),
              },
              object([
                { name: "both", required: true, shape: scalar("string") },
                { name: "extra", required: true, shape: scalar("string") },
              ]),
            ],
          },
        },
      },
    ],
  };
}

function service() {
  const description = normalizeManualEnvironment(fixture());
  const language = createLanguageService({ generation: 1, description });
  return language;
}

function open(text: string, uri = "memory:///main.kalada") {
  const language = service();
  language.openDocument({ uri, version: 1, text });
  return language;
}

describe("completion", () => {
  it("uses parser recovery for root, prefix, nested, optional, and cyclic paths", () => {
    expect(open("").completion("memory:///main.kalada", { line: 0, character: 0 })).toMatchObject({
      kind: "completion",
      items: expect.arrayContaining([expect.objectContaining({ label: "user", kind: "binding" })]),
    });
    const prefix = open("user.na").completion("memory:///main.kalada", { line: 0, character: 7 });
    expect(
      prefix.kind === "completion" && prefix.items.find(({ label }) => label === "name")?.edit,
    ).toEqual({
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } },
      text: "name",
    });
    for (const source of ["user.", "user?.", "(user).", "user.next."]) {
      const result = open(source).completion("memory:///main.kalada", {
        line: 0,
        character: source.length,
      });
      expect(result.kind === "completion" && result.items.map(({ label }) => label)).toContain(
        "name",
      );
    }
    const nested = open("user.details.").completion("memory:///main.kalada", {
      line: 0,
      character: 13,
    });
    expect(nested.kind === "completion" && nested.items.map(({ label }) => label)).toContain(
      "city",
    );
  });

  it("keeps union and intersection branch uncertainty visible", () => {
    const union = open("choice.").completion("memory:///main.kalada", { line: 0, character: 7 });
    expect(union.kind).toBe("completion");
    if (union.kind !== "completion") return;
    expect(union.items.find(({ label }) => label === "common")).toMatchObject({
      support: "conditional",
      presence: "optional",
      evidence: [expect.objectContaining({ code: "unsupported-shape" })],
    });
    expect(union.items.find(({ label }) => label === "left")?.support).toBe("conditional");
    expect(union.incomplete).toBe(true);
    const intersection = open("wrapped.").completion("memory:///main.kalada", {
      line: 0,
      character: 8,
    });
    if (intersection.kind !== "completion") return;
    expect(intersection.items.find(({ label }) => label === "both")?.support).toBe("common");
    expect(intersection.items.find(({ label }) => label === "extra")?.support).toBe("conditional");
    const viable = open("viable.").completion("memory:///main.kalada", {
      line: 0,
      character: 7,
    });
    expect(viable.kind === "completion" && viable.items[0]?.support).toBe("common");
  });

  it("does not emit unsupported source forms or structurally unsound accesses", () => {
    const user = open("user.").completion("memory:///main.kalada", { line: 0, character: 5 });
    if (user.kind !== "completion") return;
    expect(user.items.map(({ label }) => label)).not.toContain("a-b");
    expect(user.evidence).toContainEqual(
      expect.objectContaining({ code: "unsupported-source-path" }),
    );
    const known = open("known.").completion("memory:///main.kalada", { line: 0, character: 6 });
    expect(known.kind === "completion" && known.items).toEqual([]);
    for (const source of ['user."x"', "user[0]", '"user."', "user. // x", "let x = user."]) {
      const result = open(source).completion("memory:///main.kalada", {
        line: 0,
        character: source.length,
      });
      expect(result.kind === "completion" && result.items).toEqual([]);
    }
  });

  it("returns UTF-16 ranges without splitting astral text or CRLF", () => {
    const language = open("user.na\r\n😀");
    const result = language.completion("memory:///main.kalada", { line: 0, character: 7 });
    expect(result.kind === "completion" && result.items[0]?.edit.range.start.line).toBe(0);
    const astral = language.completion("memory:///main.kalada", { line: 1, character: 1 });
    expect(astral.kind === "completion" && astral.items).toEqual([]);
    expect(() => language.completion("memory:///main.kalada", { line: 0, character: 8 })).toThrow();
    const deep = `user.${"next.".repeat(40)}`;
    const limited = open(deep).completion("memory:///main.kalada", {
      line: 0,
      character: deep.length,
    });
    expect(limited.kind === "completion" && limited.incomplete).toBe(true);
    expect(limited.kind === "completion" && limited.evidence).toContainEqual(
      expect.objectContaining({ code: "query-limit" }),
    );
  });

  it("offers only syntax-owned semantic operator candidates", () => {
    const result = open("known ").completion("memory:///main.kalada", { line: 0, character: 6 });
    expect(result.kind).toBe("completion");
    if (result.kind !== "completion") return;
    expect(result.items.find(({ label }) => label === "+")).toMatchObject({
      kind: "operator",
      support: "conditional",
    });
    expect(result.items.map(({ label }) => label)).not.toContain("&&");
  });

  it("respects grammar and recovery boundaries for field and operator contexts", () => {
    for (const source of ["user.\n", "user.\r", "user.\r\n"]) {
      const result = open(source).completion("memory:///main.kalada", { line: 1, character: 0 });
      expect(result.kind === "completion" && result.items).toEqual([]);
    }
    const mixed = open("opt ?? true ").completion("memory:///main.kalada", {
      line: 0,
      character: 12,
    });
    expect(mixed.kind === "completion" && mixed.items.map(({ label }) => label)).not.toContain(
      "&&",
    );
    const relational = open("1 < 2 ").completion("memory:///main.kalada", {
      line: 0,
      character: 6,
    });
    expect(
      relational.kind === "completion" && relational.items.map(({ label }) => label),
    ).not.toContain("<");
    const postfix = open("1 + 2 ").completion("memory:///main.kalada", {
      line: 0,
      character: 6,
    });
    expect(
      postfix.kind === "completion" && postfix.items.find(({ label }) => label === "+"),
    ).toMatchObject({
      support: "conditional",
    });
    for (const source of ["1 + ", '"user."', "user. // comment"]) {
      const result = open(source).completion("memory:///main.kalada", {
        line: 0,
        character: source.length,
      });
      expect(result.kind === "completion" && result.items).toEqual([]);
    }
    const newline = open("known\n").completion("memory:///main.kalada", {
      line: 1,
      character: 0,
    });
    expect(newline.kind === "completion" && newline.items.map(({ label }) => label)).toContain("+");
  });

  it("derives postfix candidates from the completed left expression", () => {
    const cases = [
      { source: "1 + 2 ", present: ["+", "<"], absent: ["&&", "??"] },
      { source: "1 < 2 ", present: ["==", "&&"], absent: ["+", "<", "??"] },
      { source: "true && false ", present: ["==", "&&"], absent: ["+", "??"] },
      { source: "opt ?? true ", present: ["=="], absent: ["+", "&&", "??"] },
      { source: "user?.name ", present: ["==", "??"], absent: ["+", "&&"] },
    ];
    for (const { source, present, absent } of cases) {
      const result = open(source).completion("memory:///main.kalada", {
        line: 0,
        character: source.length,
      });
      expect(result.kind).toBe("completion");
      if (result.kind !== "completion") continue;
      for (const label of present) {
        expect(
          result.items.find((item) => item.label === label),
          `${source}: ${label}`,
        ).toMatchObject({ support: "conditional" });
      }
      expect(
        result.items.map(({ label }) => label).filter((label) => absent.includes(label)),
      ).toEqual([]);
    }
    const dynamic = open("unknown ").completion("memory:///main.kalada", {
      line: 0,
      character: 8,
    });
    expect(dynamic.kind === "completion" && dynamic.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "+", support: "conditional" }),
        expect.objectContaining({ label: "??", support: "conditional" }),
      ]),
    );
    expect(open("opt ?? true ?? false").diagnostics("memory:///main.kalada")).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "KALADA_OPTION_REQUIRED" })],
    });
  });

  it("keeps unknown record keys viable and emits deterministic cap evidence", () => {
    const fields = Array.from({ length: 257 }, (_, index) => ({
      name: `field${String(index).padStart(3, "0")}`,
      required: true,
      shape: scalar("string"),
    }));
    const input = fixture();
    const description = normalizeManualEnvironment({
      ...input,
      bindings: [
        ...input.bindings,
        {
          id: "record-id",
          name: "recordValue",
          path: ["recordValue"],
          semanticType: { kind: "primitive-type", name: "json" },
          editorShape: {
            root: {
              kind: "record",
              key: {
                kind: "union",
                variants: [
                  { kind: "literal", value: "known" },
                  { kind: "unknown", reason: "open key domain" },
                ],
              },
              value: scalar("string"),
              exhaustive: "unknown",
            },
          },
        },
        {
          id: "large-id",
          name: "large",
          path: ["large"],
          semanticType: { kind: "primitive-type", name: "json" },
          editorShape: { root: object(fields) },
        },
      ],
    });
    const language = createLanguageService({ generation: 1, description });
    language.openDocument({ uri: "memory:///record.kalada", version: 1, text: "recordValue." });
    const record = language.completion("memory:///record.kalada", { line: 0, character: 12 });
    expect(record.kind).toBe("completion");
    if (record.kind !== "completion") return;
    expect(record.items.find(({ label }) => label === "known")).toMatchObject({
      support: "conditional",
      presence: "unknown",
      evidence: [expect.objectContaining({ code: "unsupported-shape" })],
    });
    expect(record.incomplete).toBe(true);
    expect(record.evidence).toContainEqual(expect.objectContaining({ code: "unsupported-shape" }));
    language.closeDocument("memory:///record.kalada");
    language.openDocument({ uri: "memory:///large.kalada", version: 1, text: "large." });
    const large = language.completion("memory:///large.kalada", { line: 0, character: 6 });
    expect(large.kind === "completion" && large.items).toHaveLength(256);
    expect(large.kind === "completion" && large.incomplete).toBe(true);
    expect(large.kind === "completion" && large.evidence).toContainEqual(
      expect.objectContaining({ code: "query-limit" }),
    );
  });

  it("reports bounded limit evidence for aliases, unions, and record keys", () => {
    const names = Array.from({ length: 257 }, (_, index) => `key${String(index).padStart(3, "0")}`);
    const definitions = Array.from({ length: 40 }, (_, index) => ({
      name: `Alias${index}`,
      shape:
        index === 39
          ? object([{ name: "end", required: true, shape: scalar("string") }])
          : ({ kind: "reference", definition: `Alias${index + 1}` } as const),
    }));
    const description = normalizeManualEnvironment({
      mode: "sync",
      bindings: [
        {
          id: "aliases-id",
          name: "aliases",
          path: ["aliases"],
          semanticType: { kind: "primitive-type", name: "json" },
          editorShape: { root: { kind: "reference", definition: "Alias0" }, definitions },
        },
        {
          id: "union-cap-id",
          name: "unionCap",
          path: ["unionCap"],
          semanticType: { kind: "primitive-type", name: "json" },
          editorShape: {
            root: {
              kind: "union",
              variants: names.map((name) =>
                object([{ name, required: true, shape: scalar("string") }]),
              ),
            },
          },
        },
        {
          id: "record-cap-id",
          name: "recordCap",
          path: ["recordCap"],
          semanticType: { kind: "primitive-type", name: "json" },
          editorShape: {
            root: {
              kind: "record",
              key: { kind: "enum", values: names },
              value: scalar("string"),
              exhaustive: true,
            },
          },
        },
      ],
    });
    for (const name of ["aliases", "unionCap", "recordCap"]) {
      const language = createLanguageService({ generation: 1, description });
      const source = `${name}.`;
      language.openDocument({ uri: `memory:///${name}.kalada`, version: 1, text: source });
      const result = language.completion(`memory:///${name}.kalada`, {
        line: 0,
        character: source.length,
      });
      expect(result.kind === "completion" && result.incomplete).toBe(true);
      expect(result.kind === "completion" && result.evidence).toContainEqual(
        expect.objectContaining({ code: "query-limit" }),
      );
      expect(result.kind === "completion" && result.items.length).toBeLessThanOrEqual(256);
    }
  });
});

describe("hover and request identity", () => {
  it("separates input shape, semantic output, presence, and sanitized provenance", () => {
    const result = open("user.name").hover("memory:///main.kalada", { line: 0, character: 7 });
    expect(result.kind).toBe("hover");
    if (result.kind !== "hover") return;
    expect(result.hover).toMatchObject({
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
      output: { type: "dynamic", known: false },
      access: "supported",
    });
    expect(result.hover?.input[0]?.presence).toBe("required");
    expect(result.hover?.input[0]?.provenance).toEqual([
      { providerId: "manual.fixture", providerVersion: "1" },
    ]);
    expect(JSON.stringify(result.hover)).not.toContain("secret");
    const mismatch = open("known.visibleInput").hover("memory:///main.kalada", {
      line: 0,
      character: 8,
    });
    expect(mismatch.kind === "hover" && mismatch.hover?.access).toBe("unsupported");
    expect(mismatch.kind === "hover" && mismatch.hover?.input.length).toBeGreaterThan(0);
    const array = open("user.items").hover("memory:///main.kalada", { line: 0, character: 7 });
    expect(array.kind === "hover" && array.hover?.input.map(({ kind }) => kind)).toEqual([
      "array",
      "scalar",
    ]);
    expect(array.kind === "hover" && array.hover?.evidence).toContainEqual(
      expect.objectContaining({ code: "unsupported-source-path" }),
    );
    const tuple = open("user.pair").hover("memory:///main.kalada", { line: 0, character: 7 });
    expect(tuple.kind === "hover" && tuple.hover?.input.map(({ kind }) => kind)).toEqual([
      "tuple",
      "scalar",
      "scalar",
    ]);
  });

  it("targets bindings and fields exactly at token and UTF-16 boundaries", () => {
    const binding = open("user.name").hover("memory:///main.kalada", { line: 0, character: 1 });
    expect(binding.kind === "hover" && binding.hover).toMatchObject({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
      input: [expect.objectContaining({ kind: "object" })],
      output: { type: { kind: "primitive-type", name: "json" }, known: true },
      access: "supported",
    });
    const field = open("user.name").hover("memory:///main.kalada", { line: 0, character: 5 });
    expect(field.kind === "hover" && field.hover).toMatchObject({
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
      input: [expect.objectContaining({ kind: "scalar" })],
      access: "supported",
    });
    expect(
      open("user.name").hover("memory:///main.kalada", { line: 0, character: 4 }),
    ).toMatchObject({
      hover: null,
    });
    expect(
      open("user?.name").hover("memory:///main.kalada", { line: 0, character: 5 }),
    ).toMatchObject({
      hover: null,
    });
    const astral = open('"😀" + user.name').hover("memory:///main.kalada", {
      line: 0,
      character: 8,
    });
    expect(astral.kind === "hover" && astral.hover?.range).toEqual({
      start: { line: 0, character: 7 },
      end: { line: 0, character: 11 },
    });
  });

  it("preserves identity, staleness, cancellation, and multi-document isolation", () => {
    const language = open("user.");
    language.openDocument({ uri: "memory:///other.kalada", version: 1, text: "choice." });
    let calls = 0;
    const stale = language.completion(
      "memory:///main.kalada",
      { line: 0, character: 5 },
      {
        cancellation: {
          isCancellationRequested: () => {
            calls += 1;
            if (calls === 5) {
              language.updateDocument({
                uri: "memory:///main.kalada",
                version: 2,
                edits: [
                  {
                    range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
                    text: " ",
                  },
                ],
              });
            }
            return false;
          },
        },
      },
    );
    expect(stale).toMatchObject({
      uri: "memory:///main.kalada",
      version: 1,
      environmentGeneration: 1,
      status: "stale",
    });
    expect(language.getDocument("memory:///other.kalada")?.version).toBe(1);
    const cancelled = language.hover(
      "memory:///other.kalada",
      { line: 0, character: 2 },
      { cancellation: { isCancellationRequested: () => true } },
    );
    expect(cancelled).toMatchObject({
      kind: "cancelled",
      operation: "hover",
      checkpoint: "captured",
    });
  });

  it("cancels completion at every deterministic non-graph checkpoint", () => {
    const checkpoints = [
      "captured",
      "environment",
      "before-parse",
      "after-parse",
      "context",
      "before-query",
      "after-query",
      "complete",
    ] as const;
    checkpoints.forEach((checkpoint, target) => {
      let calls = 0;
      const result = open("").completion(
        "memory:///main.kalada",
        { line: 0, character: 0 },
        { cancellation: { isCancellationRequested: () => calls++ === target } },
      );
      expect(result).toMatchObject({ kind: "cancelled", operation: "completion", checkpoint });
    });
  });
});

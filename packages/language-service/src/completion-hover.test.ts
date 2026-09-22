import type { EditorShape, ManualProviderInput } from "@kalada/host";
import { normalizeManualEnvironment } from "@kalada/host";
import { describe, expect, it } from "vitest";
import { createLanguageService } from "./index.js";

const scalar = (name: "string" | "number"): EditorShape => ({ kind: "scalar", name });

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
    expect(array.kind === "hover" && array.hover?.input[0]?.kind).toBe("array");
    expect(array.kind === "hover" && array.hover?.evidence).toContainEqual(
      expect.objectContaining({ code: "unsupported-source-path" }),
    );
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

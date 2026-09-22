import { describe, expect, it } from "vitest";
import {
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
  queryKaladaV1Semantics,
} from "../index.js";

const number = { kind: "primitive-type", name: "number" } as const;
const boolean = { kind: "primitive-type", name: "boolean" } as const;

describe("semantic query", () => {
  it("matches lowering for complete subtree and whole-expression types", () => {
    const parsed = parseKaladaV1Expression("enabled ? count + 1 : 0");
    const options = {
      references: {
        enabled: { reference: "enabled", type: boolean },
        count: { reference: "count", type: number },
      },
    };
    const lowered = lowerKaladaV1Expression(parsed, options);
    const queried = queryKaladaV1Semantics(parsed, options);
    expect(lowered.ok).toBe(true);
    expect(queried.incomplete).toBe(false);
    expect(queried.nodes.at(-1)?.type).toEqual(lowered.ok && lowered.resultType);
    expect(queried.nodes.some(({ type }) => JSON.stringify(type) === JSON.stringify(boolean))).toBe(
      true,
    );
    expect(queried.nodes.some(({ type }) => JSON.stringify(type) === JSON.stringify(number))).toBe(
      true,
    );
  });

  it("retains child facts for recovered incomplete field access", () => {
    const parsed = parseKaladaV1Expression("user.");
    const queried = queryKaladaV1Semantics(parsed, {
      references: { user: { reference: "user", type: { kind: "primitive-type", name: "json" } } },
    });
    expect(queried.incomplete).toBe(true);
    expect(queried.nodes).toHaveLength(2);
    expect(queried.nodes[0]).toMatchObject({ known: true, fieldAccess: { plain: "supported" } });
    expect(queried.nodes[1]).toMatchObject({ known: false });
  });

  it("uses dispatch for operator and field support without guessing dynamic domains", () => {
    const parsed = parseKaladaV1Expression("value");
    const dynamic = queryKaladaV1Semantics(parsed).nodes[0];
    expect(dynamic?.operators.every(({ support }) => support === "conditional")).toBe(true);
    const callable = queryKaladaV1Semantics(parsed, {
      references: {
        value: {
          reference: "value",
          type: { kind: "function-type", parameters: [], returns: number },
        },
      },
    }).nodes[0];
    expect(callable?.operators.find(({ operator }) => operator === "==")?.support).toBe(
      "unsupported",
    );
    expect(callable?.fieldAccess.plain).toBe("unsupported");
  });

  it("rejects forged parse results and lowering options", () => {
    const parsed = parseKaladaV1Expression("1");
    const forged = { document: parsed.document, diagnostics: parsed.diagnostics };
    expect(queryKaladaV1Semantics(forged).incomplete).toBe(true);
    expect(queryKaladaV1Semantics(parsed, { extra: true } as never).incomplete).toBe(true);
  });
});

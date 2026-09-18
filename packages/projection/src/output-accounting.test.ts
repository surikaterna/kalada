import { type JsonValue, KaladaV1 as K, Option } from "@kalada/core/kalada-v1";
import { describe, expect, it } from "vitest";
import { compileProjectionV1, ProjectionV1 as P } from "./index.js";
import type {
  ProjectionNode,
  ProjectionPath,
  ProjectionResolver,
  ProjectionV1Limits,
} from "./types.js";

type OutputLimit = "maxOutputDepth" | "maxOutputNodes" | "maxOutputBytes";

interface Boundary {
  readonly equal: number;
  readonly below: number;
  readonly path: ProjectionPath;
}

interface Vector {
  readonly name: string;
  readonly node: ProjectionNode;
  readonly output: JsonValue;
  readonly resolver?: ProjectionResolver;
  readonly boundaries: Readonly<Record<OutputLimit, Boundary>>;
}

const literal = (value: JsonValue) => K.program(K.literal(value));
const value = (input: JsonValue) => P.value(literal(input));
const expression = (...tail: (string | number)[]) => ["root", "expression", ...tail] as const;

const vectors: readonly Vector[] = [
  {
    name: "nested value",
    node: value({ a: [1, "😀"] }),
    output: { a: [1, "😀"] },
    boundaries: {
      maxOutputDepth: { equal: 2, below: 1, path: expression("output", "a", 0) },
      maxOutputNodes: { equal: 4, below: 3, path: expression("output", "a", 1) },
      maxOutputBytes: { equal: 16, below: 15, path: expression() },
    },
  },
  {
    name: "constructed object",
    node: P.object([P.entry("a", value({ x: 1 })), P.entry("b", value(false))]),
    output: { a: { x: 1 }, b: false },
    boundaries: {
      maxOutputDepth: {
        equal: 2,
        below: 1,
        path: ["root", "entries", 0, "value", "expression", "output", "x"],
      },
      maxOutputNodes: {
        equal: 4,
        below: 3,
        path: ["root", "entries", 1, "value", "expression"],
      },
      maxOutputBytes: { equal: 23, below: 22, path: ["root"] },
    },
  },
  {
    name: "constructed array",
    node: P.array([value(0), P.array([value(false)])]),
    output: [0, [false]],
    boundaries: {
      maxOutputDepth: {
        equal: 2,
        below: 1,
        path: ["root", "items", 1, "items", 0, "expression"],
      },
      maxOutputNodes: {
        equal: 4,
        below: 3,
        path: ["root", "items", 1, "items", 0, "expression"],
      },
      maxOutputBytes: { equal: 11, below: 10, path: ["root"] },
    },
  },
  {
    name: "UTF-8",
    node: P.object([P.entry("é", value({ v: "😀" }))]),
    output: { é: { v: "😀" } },
    boundaries: {
      maxOutputDepth: {
        equal: 2,
        below: 1,
        path: ["root", "entries", 0, "value", "expression", "output", "v"],
      },
      maxOutputNodes: {
        equal: 3,
        below: 2,
        path: ["root", "entries", 0, "value", "expression", "output", "v"],
      },
      maxOutputBytes: { equal: 19, below: 18, path: ["root"] },
    },
  },
  {
    name: "repeated identity",
    node: P.value(literal([{ x: 1 }, { x: 1 }])),
    output: [{ x: 1 }, { x: 1 }],
    boundaries: {
      maxOutputDepth: { equal: 2, below: 1, path: expression("output", 0, "x") },
      maxOutputNodes: { equal: 5, below: 4, path: expression("output", 1, "x") },
      maxOutputBytes: { equal: 17, below: 16, path: expression() },
    },
  },
  {
    name: "no attachment recharge",
    node: P.object([P.entry("x", value({ a: 1 }))]),
    output: { x: { a: 1 } },
    boundaries: {
      maxOutputDepth: {
        equal: 2,
        below: 1,
        path: ["root", "entries", 0, "value", "expression", "output", "a"],
      },
      maxOutputNodes: {
        equal: 3,
        below: 2,
        path: ["root", "entries", 0, "value", "expression", "output", "a"],
      },
      maxOutputBytes: { equal: 13, below: 12, path: ["root"] },
    },
  },
  {
    name: "omission rollback",
    node: P.object([
      P.entry("drop", P.value(K.program(K.Option.none()))),
      P.entry("keep", value({ x: 0 })),
    ]),
    output: { keep: { x: 0 } },
    boundaries: {
      maxOutputDepth: {
        equal: 2,
        below: 1,
        path: ["root", "entries", 1, "value", "expression", "output", "x"],
      },
      maxOutputNodes: {
        equal: 3,
        below: 2,
        path: ["root", "entries", 1, "value", "expression", "output", "x"],
      },
      maxOutputBytes: { equal: 16, below: 15, path: ["root"] },
    },
  },
];

describe("projection v1 output accounting vectors", () => {
  for (const vector of vectors) {
    for (const limit of ["maxOutputDepth", "maxOutputNodes", "maxOutputBytes"] as const) {
      it(`${vector.name} accepts equal and rejects +1 ${limit}`, () => {
        const boundary = vector.boundaries[limit];
        expect(evaluate(vector, limit, boundary.equal)).toEqual({ ok: true, value: vector.output });
        expect(evaluate(vector, limit, boundary.below)).toMatchObject({
          ok: false,
          diagnostic: { code: "PROJECTION_OUTPUT_LIMIT", path: boundary.path },
        });
      });
    }
  }

  it("charges a shared resolver identity once per output occurrence", () => {
    const shared = Option.some({ x: 1 });
    const node = P.array([
      P.value(K.program(K.ref("shared"))),
      P.value(K.program(K.ref("shared"))),
    ]);
    const compiled = compileProjectionV1(P.program(node), { limits: { maxOutputNodes: 4 } });
    if (!compiled.ok) throw new Error(compiled.diagnostic.code);
    expect(compiled.value.evaluate(() => ({ found: true, value: shared }))).toMatchObject({
      ok: false,
      diagnostic: {
        code: "PROJECTION_OUTPUT_LIMIT",
        path: ["root", "items", 1, "expression", "output", "x"],
      },
    });
  });
});

function evaluate(vector: Vector, limit: OutputLimit, value: number) {
  const limits = { [limit]: value } as Pick<ProjectionV1Limits, OutputLimit>;
  const compiled = compileProjectionV1(P.program(vector.node), { limits });
  if (!compiled.ok) throw new Error(compiled.diagnostic.code);
  return compiled.value.evaluate(vector.resolver ?? (() => ({ found: false })));
}

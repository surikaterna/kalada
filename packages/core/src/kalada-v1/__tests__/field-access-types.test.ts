import { expect, it } from "vitest";
import {
  compileKaladaV1Program,
  type KaladaType,
  KaladaV1,
  type KaladaV1Expression,
} from "../index.js";

const number = KaladaV1.Type.primitive("number");
const string = KaladaV1.Type.primitive("string");
const nullType = KaladaV1.Type.primitive("null");
const optionNumber = KaladaV1.Type.option(number);

function compileReturn(returns: KaladaType, body: KaladaV1Expression) {
  return compileKaladaV1Program(KaladaV1.program(KaladaV1.function([], returns, body)));
}

it("keeps nonliteral strict and optional field results dynamic", () => {
  expect(
    compileReturn(number, KaladaV1.fieldAccess(KaladaV1.ref("dynamic"), "value")),
  ).toMatchObject({ ok: true });
  expect(
    compileReturn(optionNumber, KaladaV1.optionalFieldAccess(KaladaV1.ref("dynamic"), "value")),
  ).toMatchObject({ ok: true });
});

it("infers narrow literal and raw-null field result types", () => {
  expect(
    compileReturn(number, KaladaV1.fieldAccess(KaladaV1.literal({ value: 1 }), "value")),
  ).toMatchObject({ ok: true });
  expect(
    compileReturn(
      KaladaV1.Type.option(nullType),
      KaladaV1.optionalFieldAccess(KaladaV1.literal(null), "value"),
    ),
  ).toMatchObject({ ok: true });
  expect(
    compileReturn(
      optionNumber,
      KaladaV1.optionalFieldAccess(KaladaV1.literal({ value: 1 }), "value"),
    ),
  ).toMatchObject({ ok: true });
  expect(
    compileReturn(
      optionNumber,
      KaladaV1.optionalFieldAccess(KaladaV1.Option.some(KaladaV1.literal({ value: 1 })), "value"),
    ),
  ).toMatchObject({ ok: true });
});

it("rejects return contracts incompatible with provable field payloads", () => {
  expect(
    compileReturn(string, KaladaV1.fieldAccess(KaladaV1.literal({ value: 1 }), "value")),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" } });
  expect(
    compileReturn(optionNumber, KaladaV1.optionalFieldAccess(KaladaV1.literal(null), "value")),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" } });
  expect(
    compileReturn(
      KaladaV1.Type.option(string),
      KaladaV1.optionalFieldAccess(KaladaV1.literal({ value: 1 }), "value"),
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: "KALADA_FUNCTION_TYPE_MISMATCH" } });
});

it("preserves diagnostics for statically known invalid targets", () => {
  for (const target of [
    KaladaV1.literal(1),
    KaladaV1.literal([]),
    KaladaV1.Result.ok(KaladaV1.literal({})),
    KaladaV1.coreFunction("map"),
  ]) {
    expect(
      compileKaladaV1Program(KaladaV1.program(KaladaV1.fieldAccess(target, "value"))),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_FIELD_TYPE_MISMATCH", path: ["expression", "target"] },
    });
  }
  for (const target of [
    KaladaV1.literal(false),
    KaladaV1.literal([]),
    KaladaV1.Option.some(KaladaV1.literal(1)),
  ]) {
    expect(
      compileKaladaV1Program(KaladaV1.program(KaladaV1.optionalFieldAccess(target, "value"))),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KALADA_FIELD_TYPE_MISMATCH", path: ["expression", "target"] },
    });
  }
});

import type { JsonValue } from "./json.js";
import type { KaladaV1Expression, KaladaV1Program, MatchArm } from "./types.js";

const literal = <R extends JsonValue = string>(value: JsonValue): KaladaV1Expression<R> => ({
  kind: "literal",
  value,
});
const ref = <R extends JsonValue = string>(value: R): KaladaV1Expression<R> => ({
  kind: "ref",
  ref: value,
});
const binding = <R extends JsonValue>(
  name: string,
  value: KaladaV1Expression<R>,
  body: KaladaV1Expression<R>,
): KaladaV1Expression<R> => ({ kind: "binding", name, value, body });
const some = <R extends JsonValue>(value: KaladaV1Expression<R>): KaladaV1Expression<R> => ({
  kind: "option",
  variant: "some",
  value,
});
const none = <R extends JsonValue = string>(): KaladaV1Expression<R> => ({
  kind: "option",
  variant: "none",
});
const ok = <R extends JsonValue>(value: KaladaV1Expression<R>): KaladaV1Expression<R> => ({
  kind: "result",
  variant: "ok",
  value,
});
const err = <R extends JsonValue>(value: KaladaV1Expression<R>): KaladaV1Expression<R> => ({
  kind: "result",
  variant: "err",
  value,
});
const arm = <R extends JsonValue>(
  variant: MatchArm<R>["variant"],
  body: KaladaV1Expression<R>,
  name?: string,
): MatchArm<R> => ({ variant, ...(name === undefined ? {} : { binding: name }), body });
const match = <R extends JsonValue>(
  type: "Option" | "Result",
  value: KaladaV1Expression<R>,
  arms: readonly MatchArm<R>[],
): KaladaV1Expression<R> => ({ kind: "match", type, value, arms });

export const KaladaV1 = Object.freeze({
  literal,
  ref,
  binding,
  Option: Object.freeze({ some, none }),
  Result: Object.freeze({ ok, err }),
  arm,
  match,
  program<R extends JsonValue = string>(expression: KaladaV1Expression<R>): KaladaV1Program<R> {
    return { format: "kalada-program", version: 1, profile: "kalada-v1", expression };
  },
});

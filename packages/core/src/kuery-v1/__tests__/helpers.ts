import type { JsonValue, ValueExpression } from "../index.js";

export const literal = (value: JsonValue): ValueExpression => ({ kind: "literal", value });
export const ref = (value: string): ValueExpression => ({ kind: "ref", ref: value });
export const op = (name: string, ...args: ValueExpression[]): ValueExpression => ({
  kind: "op",
  op: name,
  args,
});

import type { KaladaBinaryOperator } from "./cst-types.js";

const tiers = Object.freeze({
  multiplicative: Object.freeze(["*", "/", "%"] as const),
  additive: Object.freeze(["+", "-"] as const),
  relational: Object.freeze(["<", "<=", ">", ">=", "in"] as const),
  equality: Object.freeze(["==", "!="] as const),
  logicalAnd: Object.freeze(["&&"] as const),
  logicalXor: Object.freeze(["xor"] as const),
  logicalOr: Object.freeze(["||"] as const),
  coalesce: Object.freeze(["??"] as const),
});

export const BINARY_OPERATOR_TIERS = Object.freeze({
  multiplicative: new Set<string>(tiers.multiplicative),
  additive: new Set<string>(tiers.additive),
  relational: new Set<string>(tiers.relational),
  equality: new Set<string>(tiers.equality),
  logicalAnd: new Set<string>(tiers.logicalAnd),
  logicalXor: new Set<string>(tiers.logicalXor),
  logicalOr: new Set<string>(tiers.logicalOr),
  coalesce: new Set<string>(tiers.coalesce),
});

export const BINARY_OPERATORS: readonly KaladaBinaryOperator[] = Object.freeze([
  ...tiers.multiplicative,
  ...tiers.additive,
  ...tiers.relational,
  ...tiers.equality,
  ...tiers.logicalAnd,
  ...tiers.logicalXor,
  ...tiers.logicalOr,
  ...tiers.coalesce,
]);

export function isAdditiveOperator(operator: KaladaBinaryOperator): operator is "+" | "-" {
  return BINARY_OPERATOR_TIERS.additive.has(operator);
}

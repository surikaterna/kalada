import type { KaladaCstNode } from "./cst-types.js";

export const RELATIONAL_OPERATORS = new Set(["<", "<=", ">", ">=", "in"]);

export interface Parsed {
  readonly node: KaladaCstNode;
  readonly coalesce: boolean;
  readonly logical: boolean;
  readonly depth: number;
}

export function maxParsedDepth(...values: readonly Parsed[]): number {
  return Math.max(...values.map((value) => value.depth));
}

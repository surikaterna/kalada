import { canonicalizeExpression, referenceIdentity } from "./canonicalize.js";
import { success } from "./result.js";
import type { CanonicalizeExpressionOptions, JsonValue, Result, ValueExpression } from "./types.js";

/** Extract canonical references in first-seen AST order, deduplicated by structural JSON equality. */
export function extractExpressionDependencies<R extends JsonValue = string>(
  input: unknown,
  options: CanonicalizeExpressionOptions<R> = {},
): Result<readonly R[]> {
  const canonical = canonicalizeExpression<R>(input, options);
  if (!canonical.ok) return canonical;
  return success(collectExpressionDependencies(canonical.value));
}

export function collectExpressionDependencies<R extends JsonValue>(
  expression: ValueExpression<R>,
): readonly R[] {
  const dependencies: R[] = [];
  const seen = new Set<string>();
  const visit = (node: ValueExpression<R>): void => {
    if (node.kind === "ref") {
      const identity = referenceIdentity(node.ref);
      if (!seen.has(identity)) {
        seen.add(identity);
        dependencies.push(node.ref);
      }
      return;
    }
    if (node.kind === "op") node.args.forEach(visit);
  };
  visit(expression);
  return Object.freeze(dependencies);
}

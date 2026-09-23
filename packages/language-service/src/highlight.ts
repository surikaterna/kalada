import {
  DEFAULT_KALADA_SYNTAX_LIMITS,
  type KaladaCstNode,
  type KaladaParseResult,
  type KaladaToken,
} from "@kalada/syntax";
import type { HighlightKind, HighlightSpan } from "./contracts.js";

export function classifyHighlight(parsed: KaladaParseResult): readonly HighlightSpan[] {
  if (parsed.document.source.length > DEFAULT_KALADA_SYNTAX_LIMITS.maxSourceLength)
    return Object.freeze([]);
  const fields = new Set<number>();
  const pending: KaladaCstNode[] = [parsed.document.expression];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    switch (node.kind) {
      case "field-access":
        if (node.fieldToken !== null) fields.add(node.fieldToken);
        pending.push(node.target);
        break;
      case "binary":
        pending.push(node.left, node.right);
        break;
      case "conditional":
        pending.push(node.condition, node.then, node.else);
        break;
      case "group":
        pending.push(node.expression);
        break;
      case "unary":
        pending.push(node.operand);
        break;
    }
  }
  return Object.freeze(
    parsed.document.tokens.flatMap((token, index) => {
      const kind = tokenKind(token, fields.has(index));
      return kind && token.range.end > token.range.start
        ? [Object.freeze({ from: token.range.start, to: token.range.end, kind })]
        : [];
    }),
  );
}

function tokenKind(token: KaladaToken, field: boolean): HighlightKind | null {
  switch (token.kind) {
    case "identifier":
      return field ? "field" : "reference";
    case "number":
    case "string":
      return "literal";
    case "true":
    case "false":
    case "null":
    case "in":
    case "xor":
      return "keyword";
    case "operator":
      return "operator";
    case "invalid":
      return "invalid";
    case "unsupported":
      return "unsupported";
    case "whitespace":
    case "eof":
      return null;
    default:
      return "punctuation";
  }
}

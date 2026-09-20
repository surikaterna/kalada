import type { KaladaCstDocument, KaladaCstNode } from "./cst-types.js";
import { deepFreeze } from "./freeze.js";
import { parseKaladaV1Expression } from "./parse.js";
import type { KaladaFormatOutcome, KaladaParseOptions } from "./public-types.js";

export function formatKaladaV1Expression(
  source: string,
  options?: KaladaParseOptions,
): KaladaFormatOutcome {
  const parsed = parseKaladaV1Expression(source, options);
  if (parsed.diagnostics.length > 0) {
    return deepFreeze({ ok: false, diagnostics: parsed.diagnostics });
  }
  return Object.freeze({ ok: true, text: formatNode(parsed.document.expression, parsed.document) });
}

function formatNode(node: KaladaCstNode, document: KaladaCstDocument): string {
  if (node.kind === "literal" || node.kind === "reference") {
    return document.tokens[node.token]?.text ?? "";
  }
  if (node.kind === "group") return formatGroup(node, document);
  if (node.kind === "field-access") {
    const operator = document.tokens[node.operatorToken]?.text ?? "";
    const field = node.fieldToken === null ? "" : (document.tokens[node.fieldToken]?.text ?? "");
    return `${formatNode(node.target, document)}${operator}${field}`;
  }
  if (node.kind === "unary") return formatUnary(node, document);
  if (node.kind === "binary") {
    return `${formatNode(node.left, document)} ${node.operator} ${formatNode(node.right, document)}`;
  }
  if (node.kind === "conditional") {
    return `${formatNode(node.condition, document)} ? ${formatNode(node.then, document)} : ${formatNode(node.else, document)}`;
  }
  return "";
}

function formatUnary(
  node: Extract<KaladaCstNode, { kind: "unary" }>,
  document: KaladaCstDocument,
): string {
  const sameSign =
    (node.operator === "+" || node.operator === "-") &&
    node.operand.kind === "unary" &&
    node.operand.operator === node.operator;
  return `${node.operator}${sameSign ? " " : ""}${formatNode(node.operand, document)}`;
}

function formatGroup(
  node: Extract<KaladaCstNode, { kind: "group" }>,
  document: KaladaCstDocument,
): string {
  return `(${formatNode(node.expression, document)})`;
}

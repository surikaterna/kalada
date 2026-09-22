import ts from "typescript";

export function staticString(value: ts.Expression | undefined): string | undefined {
  if (!value) return undefined;
  const expression = unwrapExpression(value);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) return staticTemplate(expression);
  if (isStringAddition(expression)) {
    const left = staticString(expression.left);
    const right = staticString(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isCallExpression(expression) && memberName(expression.expression) === "concat") {
    const owner = memberOwner(expression.expression);
    const parts = [owner && staticString(owner), ...expression.arguments.map(staticString)];
    return parts.some((part) => part === undefined) ? undefined : parts.join("");
  }
  return undefined;
}

export function unwrapExpression(value: ts.Expression): ts.Expression {
  let expression = value;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isPartiallyEmittedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

export function memberName(value: ts.Expression): string | undefined {
  const expression = unwrapExpression(value);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return staticString(expression.argumentExpression);
  return undefined;
}

export function memberOwner(value: ts.Expression): ts.Expression | undefined {
  const expression = unwrapExpression(value);
  return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
    ? expression.expression
    : undefined;
}

export function isInertLiteralArray(node: ts.ArrayLiteralExpression): boolean {
  return node.elements.every(
    (element) =>
      ts.isNumericLiteral(element) ||
      ts.isStringLiteral(element) ||
      element.kind === ts.SyntaxKind.TrueKeyword ||
      element.kind === ts.SyntaxKind.FalseKeyword ||
      element.kind === ts.SyntaxKind.NullKeyword,
  );
}

function isStringAddition(
  value: ts.Expression,
): value is ts.BinaryExpression & { operatorToken: { kind: ts.SyntaxKind.PlusToken } } {
  return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

function staticTemplate(value: ts.TemplateExpression): string | undefined {
  let result = value.head.text;
  for (const span of value.templateSpans) {
    const expression = staticString(span.expression);
    if (expression === undefined) return undefined;
    result += expression + span.literal.text;
  }
  return result;
}

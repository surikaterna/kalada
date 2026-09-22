import ts from "typescript";
import {
  type AbstractValue,
  arrayValue,
  Flow,
  flowing,
  isInertLiteralArray,
  mergeValues,
  SAFE,
} from "./security-flow.js";

type Evaluate = (expression: ts.Expression) => AbstractValue;
type DepthFailure = (node: ts.Node) => AbstractValue;

export function binaryExpressionValue(
  node: ts.BinaryExpression,
  evaluate: Evaluate,
): AbstractValue {
  if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    evaluate(node.left);
    return evaluate(node.right);
  }
  if (isLogicalOperator(node.operatorToken.kind)) {
    return mergeValues(evaluate(node.left), evaluate(node.right));
  }
  return node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? evaluate(node.right) : SAFE;
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ].includes(kind);
}

export function arrayExpressionValue(
  node: ts.ArrayLiteralExpression,
  max: number,
  evaluate: Evaluate,
  depthFailure: DepthFailure,
): AbstractValue {
  if (node.elements.length > max) {
    return isInertLiteralArray(node) ? SAFE : depthFailure(node);
  }
  const elements: AbstractValue[] = [];
  let exact = true;
  for (const element of node.elements) {
    if (ts.isOmittedExpression(element)) {
      exact = false;
      elements.push(SAFE);
    } else if (!ts.isSpreadElement(element)) {
      elements.push(evaluate(element));
    } else {
      const spread = evaluate(element.expression);
      if (spread.tupleExact && spread.elements) elements.push(...spread.elements);
      else {
        exact = false;
        elements.push(flowing(Flow.UnknownHost));
      }
    }
  }
  return arrayValue(elements, exact);
}

export function forwardedExpression(node: ts.Expression): ts.Expression | undefined {
  if (ts.isAwaitExpression(node)) return node.expression;
  return ts.isYieldExpression(node) ? node.expression : undefined;
}

import ts from "typescript";

export function isBoundedFunction(node: ts.FunctionLikeDeclaration): boolean {
  if (!isInspectableFunction(node)) return false;
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return true;
  if (!ts.isBlock(node.body) || node.body.statements.length > 12) return false;
  return node.body.statements.every(isSummaryStatement);
}

export function isInspectableFunction(node: ts.FunctionLikeDeclaration): boolean {
  return node.end - node.pos <= 1_000 && node.body !== undefined;
}

function isSummaryStatement(statement: ts.Statement): boolean {
  return (
    ts.isReturnStatement(statement) ||
    ts.isVariableStatement(statement) ||
    ts.isExpressionStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  );
}

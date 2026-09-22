import ts from "typescript";
import { memberName, memberOwner, staticString, unwrapExpression } from "./security-flow.js";

export const FORBIDDEN_GLOBALS = new Set([
  "Buffer",
  "Bun",
  "Deno",
  "EventSource",
  "Function",
  "WebSocket",
  "XMLHttpRequest",
  "__dirname",
  "__filename",
  "eval",
  "fetch",
  "process",
  "require",
]);
export const FORBIDDEN_PROPERTIES = new Set([...FORBIDDEN_GLOBALS, "constructor", "sendBeacon"]);
export const GLOBAL_HOSTS = new Set(["global", "globalThis", "navigator", "self", "window"]);
export const HOST_CHILDREN = new Set(["globalThis", "navigator", "self", "window"]);
export const CALL_WRAPPERS = new Set(["apply", "bind", "call"]);

export type ModuleNode = ts.ImportDeclaration | ts.ExportDeclaration;

export function isAssignment(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

export function isMemberExpression(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

export function isInvocation(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  return ts.isCallExpression(node) || ts.isNewExpression(node);
}

export function isFunctionExpression(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

export function isDeclarationBinding(node: ts.Node): boolean {
  let current = node.parent;
  while (
    ts.isBindingElement(current) ||
    ts.isObjectBindingPattern(current) ||
    ts.isArrayBindingPattern(current)
  ) {
    current = current.parent;
  }
  return (
    ts.isVariableDeclaration(current) ||
    ts.isParameter(current) ||
    ts.isFunctionDeclaration(current)
  );
}

export function isSecurityExpression(node: ts.Node): node is ts.Expression {
  return isMemberExpression(node) || isInvocation(node);
}

export function isModuleNode(node: ts.Node): node is ModuleNode {
  return (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined
  );
}

export function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  return !(
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node)
  );
}

export function isSafeFunctionReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
  ) {
    return parent.right === node;
  }
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    parent.name.text === "prototype"
  );
}

export function isSymbolFactory(value: ts.Expression): boolean {
  const expression = unwrapExpression(value);
  return (
    (ts.isIdentifier(expression) && expression.text === "Symbol") ||
    (memberName(expression) === "for" && memberOwner(expression)?.getText() === "Symbol")
  );
}

export function isCallWrapper(value: ts.Expression): boolean {
  const name = memberName(value);
  return name !== undefined && CALL_WRAPPERS.has(name);
}

export function isBundledRelativeImport(value: string): boolean {
  return /^\.\/[A-Za-z0-9_.-]+\.js$/u.test(value);
}

export function moduleSpecifier(node: ModuleNode): string | undefined {
  return staticString(node.moduleSpecifier);
}

export function functionReturnExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  if (!fn.body || !ts.isBlock(fn.body)) return [];
  const returns: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== fn.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return returns;
}

export function lexicalScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current ?? node.getSourceFile();
}

export function parentScope(scope: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = scope.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current;
}

function isLexicalScope(node: ts.Node): boolean {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node);
}

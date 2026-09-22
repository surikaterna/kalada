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
export const AMBIENT_TIMERS = new Set(["setInterval", "setTimeout"]);
export const SAFE_EMITTED_HOST_CALLS = new Set([
  "globalThis.__ͼ.toString",
  "navigator.scheduling.isInputPending",
  "window.__ͼ.toString",
  "window.dispatchEvent",
  "window.EditContext().addEventListener",
  "window.EditContext().text.slice",
  "window.getComputedStyle",
  "window.matchMedia",
  "window.onerror",
  "window.scrollBy",
  "window.visualViewport.addEventListener",
  "window.EditContext().updateCharacterBounds",
]);
export const SAFE_EMITTED_HOST_CONSTRUCTORS = new Set(["window.EditContext"]);
export const SAFE_EMITTED_HOST_VALUES = new Set([
  "navigator.platform",
  "navigator.scheduling",
  "navigator.userAgent",
  "self.location",
  "self.location.origin",
  "self.location.pathname",
  "window.innerHeight",
  "window.innerWidth",
  "window.location",
  "window.visualViewport",
  "window.visualViewport.height",
  "window.visualViewport.offsetTop",
]);

export type ModuleNode = ts.ImportDeclaration | ts.ExportDeclaration;

export function isAssignment(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

export function isMutationAssignment(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

export function isMemberExpression(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

export type InvocationNode = ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression;

export function isInvocation(node: ts.Node): node is InvocationNode {
  return (
    ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)
  );
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

export function lexicalScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current ?? node.getSourceFile();
}

export function declarationScope(node: ts.Node): ts.Node {
  const declaration = bindingDeclaration(node);
  if (declaration && ts.isVariableDeclaration(declaration) && isVarDeclaration(declaration)) {
    return hoistScope(declaration);
  }
  return lexicalScope(node);
}

export function parentScope(scope: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = scope.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current;
}

function isLexicalScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isFunctionLike(node) ||
    ts.isClassLike(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCaseBlock(node)
  );
}

function bindingDeclaration(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (
    current &&
    (ts.isIdentifier(current) ||
      ts.isBindingElement(current) ||
      ts.isObjectBindingPattern(current) ||
      ts.isArrayBindingPattern(current))
  ) {
    current = current.parent;
  }
  return current;
}

function isVarDeclaration(node: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.BlockScoped) === 0
  );
}

function hoistScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
    current = current.parent;
  }
  return current ?? node.getSourceFile();
}

import ts from "typescript";

const AMBIENT_OWNERS = new Set(["document", "globalThis", "parent", "self", "top", "window"]);

// This policy recognizes only direct ambient navigation syntax and lexical shadowing.
export function directNavigationFailures(file: ts.SourceFile): Set<string> {
  const bindings = new LexicalBindings(file);
  const failures = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) inspectAssignment(node, bindings, failures);
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      inspectUpdate(node, bindings, failures);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return failures;
}

class LexicalBindings {
  private readonly declarations = new Map<ts.Node, Set<string>>();

  constructor(file: ts.SourceFile) {
    this.collect(file);
  }

  isShadowed(name: string, node: ts.Node): boolean {
    let scope: ts.Node | undefined = lexicalScope(node);
    while (scope) {
      if (this.declarations.get(scope)?.has(name)) return true;
      scope = parentScope(scope);
    }
    return false;
  }

  private collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      this.collectName(node.name, declarationScope(node));
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      this.declare(node.name.text, lexicalScope(node));
    } else if (ts.isFunctionExpression(node) && node.name) {
      this.declare(node.name.text, node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      this.declare(node.name.text, lexicalScope(node));
    } else if (ts.isClassExpression(node) && node.name) {
      this.declare(node.name.text, node);
    } else if (ts.isImportClause(node) && node.name) {
      this.declare(node.name.text, declarationScope(node));
    } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      this.declare(node.name.text, declarationScope(node));
    }
    ts.forEachChild(node, this.collect);
  };

  private collectName(name: ts.BindingName, scope: ts.Node): void {
    if (ts.isIdentifier(name)) {
      this.declare(name.text, scope);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) this.collectName(element.name, scope);
    }
  }

  private declare(name: string, scope: ts.Node): void {
    if (name !== "location" && !AMBIENT_OWNERS.has(name)) return;
    const names = this.declarations.get(scope) ?? new Set<string>();
    names.add(name);
    this.declarations.set(scope, names);
  }
}

function inspectAssignment(
  node: ts.BinaryExpression,
  bindings: LexicalBindings,
  failures: Set<string>,
): void {
  if (!isAssignmentOperator(node.operatorToken.kind)) return;
  const targets = navigationTargets(node.left, bindings);
  if (!targets.length) return;
  const directEquals = node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  const assigned = directEquals && targets.length === 1 ? literalText(node.right) : undefined;
  if (assigned !== undefined && !isActiveExternalUrl(assigned)) return;
  const reason =
    assigned === undefined ? "indeterminate ambient location assignment" : `active URL ${assigned}`;
  addFailure(failures, reason, node);
}

function inspectUpdate(
  node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
  bindings: LexicalBindings,
  failures: Set<string>,
): void {
  if (
    node.operator !== ts.SyntaxKind.PlusPlusToken &&
    node.operator !== ts.SyntaxKind.MinusMinusToken
  )
    return;
  if (isAmbientLocationTarget(node.operand, bindings)) {
    addFailure(failures, "ambient location update", node);
  }
}

function navigationTargets(node: ts.Expression, bindings: LexicalBindings): ts.Expression[] {
  const value = unwrap(node);
  if (isAmbientLocationTarget(value, bindings)) return [value];
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.flatMap((element) =>
      ts.isOmittedExpression(element)
        ? []
        : navigationTargets(ts.isSpreadElement(element) ? element.expression : element, bindings),
    );
  }
  if (!ts.isObjectLiteralExpression(value)) return [];
  return value.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return navigationTargets(property.expression, bindings);
    if (ts.isShorthandPropertyAssignment(property))
      return navigationTargets(property.name, bindings);
    return ts.isPropertyAssignment(property)
      ? navigationTargets(property.initializer, bindings)
      : [];
  });
}

function isAmbientLocationTarget(node: ts.Expression, bindings: LexicalBindings): boolean {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) {
    return value.text === "location" && !bindings.isShadowed("location", value);
  }
  if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value)) return false;
  if (memberName(value) !== "location") return false;
  const owner = unwrap(value.expression);
  if (!ts.isIdentifier(owner) || !AMBIENT_OWNERS.has(owner.text)) return false;
  return !bindings.isShadowed(owner.text, owner);
}

function memberName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = node.argumentExpression;
  return ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function declarationScope(node: ts.Node): ts.Node {
  if (ts.isVariableDeclaration(node) && isVarDeclaration(node)) return hoistScope(node);
  return lexicalScope(node);
}

function lexicalScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current ?? node.getSourceFile();
}

function parentScope(scope: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = scope.parent;
  while (current && !isLexicalScope(current)) current = current.parent;
  return current;
}

function isLexicalScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isFunctionLike(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  );
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

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function literalText(node: ts.Expression): string | undefined {
  const value = unwrap(node);
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  let value = node;
  while (ts.isParenthesizedExpression(value) || ts.isNonNullExpression(value))
    value = value.expression;
  return value;
}

function isActiveExternalUrl(value: string): boolean {
  return value.startsWith("/") || /^(?:https?|wss?):\/\//u.test(value);
}

function addFailure(failures: Set<string>, reason: string, node: ts.Node): void {
  const file = node.getSourceFile();
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  failures.add(`${reason} at ${position.line + 1}:${position.character + 1}`);
}

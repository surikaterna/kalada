import * as ts from "typescript";

export function isModuleCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require") ||
    (ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "module" &&
      callee.name.text === "require")
  );
}

export function moduleSpecifier(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
    return node.moduleReference.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal as ts.Expression;
  if (isModuleCall(node)) return node.arguments[0];
  return undefined;
}

export function importsModule(source: string, name: string): boolean {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  let found = false;
  function visit(node: ts.Node): void {
    const specifier = moduleSpecifier(node);
    if (specifier && ts.isStringLiteral(specifier)) {
      if (specifier.text === name || specifier.text.startsWith(`${name}/`)) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

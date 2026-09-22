import ts from "typescript";
import {
  declarationScope,
  FORBIDDEN_GLOBALS,
  isIdentifierReference,
  isSafeFunctionReference,
  lexicalScope,
  parentScope,
} from "./security-policy.js";

export class StaticSinkPolicy {
  readonly failures = new Set<string>();
  private readonly declarations = new Map<ts.Node, Set<string>>();

  constructor(private readonly file: ts.SourceFile) {}

  scan(): void {
    this.collectDeclarations(this.file);
    this.visit(this.file);
  }

  private collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      this.collectBinding(node.name, declarationScope(node.name));
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      this.declare(node.name.text, declarationScope(node));
    }
    if (ts.isFunctionExpression(node) && node.name) {
      this.declare(node.name.text, node);
    }
    if (ts.isClassDeclaration(node) && node.name) {
      this.declare(node.name.text, lexicalScope(node));
    }
    if (ts.isClassExpression(node) && node.name) {
      this.declare(node.name.text, node);
    }
    if (ts.isImportClause(node) && node.name) {
      this.declare(node.name.text, declarationScope(node.name));
    }
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      this.declare(node.name.text, declarationScope(node.name));
    }
    ts.forEachChild(node, this.collectDeclarations);
  };

  private collectBinding(name: ts.BindingName, scope: ts.Node): void {
    if (ts.isIdentifier(name)) {
      this.declare(name.text, scope);
      return;
    }
    for (const element of name.elements) this.collectBinding(element.name, scope);
  }

  private declare(name: string, scope: ts.Node): void {
    const names = this.declarations.get(scope) ?? new Set<string>();
    names.add(name);
    this.declarations.set(scope, names);
  }

  private visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) this.inspectIdentifier(node);
    ts.forEachChild(node, this.visit);
  };

  private inspectIdentifier(node: ts.Identifier): void {
    if (!FORBIDDEN_GLOBALS.has(node.text) || !isIdentifierReference(node)) return;
    if (this.isShadowed(node.text, node)) return;
    if (node.text === "process" && ts.isTypeOfExpression(node.parent)) return;
    if (node.text === "Function" && isSafeFunctionReference(node)) return;
    this.fail(`forbidden global identifier ${node.text}`, node);
  }

  private isShadowed(name: string, node: ts.Node): boolean {
    let scope: ts.Node | undefined = lexicalScope(node);
    while (scope) {
      if (this.declarations.get(scope)?.has(name)) return true;
      scope = parentScope(scope);
    }
    return false;
  }

  private fail(reason: string, node: ts.Node): void {
    const position = this.file.getLineAndCharacterOfPosition(node.getStart(this.file));
    const source = node.getText(this.file).replace(/\s+/gu, " ").slice(0, 100);
    this.failures.add(`${reason} at ${position.line + 1}:${position.character + 1} (${source})`);
  }
}

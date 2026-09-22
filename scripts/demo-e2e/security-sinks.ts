import ts from "typescript";
import { staticString } from "./security-flow.js";
import {
  FORBIDDEN_GLOBALS,
  FORBIDDEN_PROPERTIES,
  isIdentifierReference,
  isSafeFunctionReference,
  lexicalScope,
  parentScope,
} from "./security-policy.js";

const STATIC_SINKS = new Set([...FORBIDDEN_PROPERTIES].filter((name) => name !== "constructor"));

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
      this.collectBinding(node.name);
    }
    if (ts.isFunctionDeclaration(node) && node.name) this.declare(node.name.text, node);
    if (ts.isClassDeclaration(node) && node.name) this.declare(node.name.text, node);
    if (ts.isImportClause(node) && node.name) this.declare(node.name.text, node);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      this.declare(node.name.text, node);
    }
    ts.forEachChild(node, this.collectDeclarations);
  };

  private collectBinding(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      this.declare(name.text, name.parent);
      return;
    }
    for (const element of name.elements) this.collectBinding(element.name);
  }

  private declare(name: string, target: ts.Node): void {
    const scope = lexicalScope(target);
    const names = this.declarations.get(scope) ?? new Set<string>();
    names.add(name);
    this.declarations.set(scope, names);
  }

  private visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) this.inspectIdentifier(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      this.inspectStaticValue(node.text, node);
    }
    if (ts.isTemplateExpression(node) || ts.isBinaryExpression(node) || ts.isCallExpression(node)) {
      const value = staticString(node);
      if (value !== undefined) this.inspectStaticValue(value, node);
    }
    if (ts.isPropertyAccessExpression(node)) this.inspectMember(node.name.text, node);
    if (ts.isElementAccessExpression(node)) {
      const key = staticString(node.argumentExpression);
      if (key !== undefined) this.inspectMember(key, node);
    }
    if (ts.isBindingElement(node)) this.inspectBindingKey(node);
    if (isPropertyDefinition(node)) this.inspectPropertyDefinition(node);
    ts.forEachChild(node, this.visit);
  };

  private inspectIdentifier(node: ts.Identifier): void {
    if (!FORBIDDEN_GLOBALS.has(node.text) || !isIdentifierReference(node)) return;
    if (this.isShadowed(node.text, node)) return;
    if (node.text === "process" && ts.isTypeOfExpression(node.parent)) return;
    if (node.text === "Function" && isSafeFunctionReference(node)) return;
    this.fail(`forbidden global identifier ${node.text}`, node);
  }

  private inspectStaticValue(value: string, node: ts.Node): void {
    if (STATIC_SINKS.has(value)) this.fail(`forbidden static value ${value}`, node);
  }

  private inspectMember(key: string, node: ts.Node): void {
    if (!STATIC_SINKS.has(key) || isSafeDocumentRequire(node)) return;
    this.fail(`forbidden static member key ${key}`, node);
  }

  private inspectBindingKey(node: ts.BindingElement): void {
    const key = bindingKey(node);
    if (key && STATIC_SINKS.has(key)) {
      this.fail(`forbidden static destructuring key ${key}`, node);
    }
  }

  private inspectPropertyDefinition(node: PropertyDefinition): void {
    const key = propertyName(node.name);
    if (!key || !STATIC_SINKS.has(key) || isSafeRequireDefinition(node, key)) return;
    this.fail(`forbidden static property key ${key}`, node.name);
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

type PropertyDefinition =
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.PropertyAssignment
  | ts.PropertyDeclaration
  | ts.SetAccessorDeclaration
  | ts.ShorthandPropertyAssignment;

function isPropertyDefinition(node: ts.Node): node is PropertyDefinition {
  return (
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isShorthandPropertyAssignment(node)
  );
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) return staticString(name.expression);
  return name.text;
}

function bindingKey(element: ts.BindingElement): string | undefined {
  if (!element.propertyName) return ts.isIdentifier(element.name) ? element.name.text : undefined;
  if (ts.isComputedPropertyName(element.propertyName)) {
    return staticString(element.propertyName.expression);
  }
  return element.propertyName.text;
}

function isSafeDocumentRequire(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "require") return false;
  if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return true;
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.expression.name.text === "store"
  );
}

function isSafeRequireDefinition(node: PropertyDefinition, key: string): boolean {
  if (key !== "require" || !ts.isMethodDeclaration(node) || !node.body) return false;
  let documentsGet = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(child) &&
      child.name.text === "get" &&
      ts.isPropertyAccessExpression(child.expression) &&
      child.expression.name.text === "documents" &&
      child.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      documentsGet = true;
    }
    ts.forEachChild(child, visit);
  };
  visit(node.body);
  return documentsGet;
}

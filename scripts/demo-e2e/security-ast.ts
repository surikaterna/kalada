import ts from "typescript";

const FORBIDDEN_GLOBALS = new Set([
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
const FORBIDDEN_PROPERTIES = new Set([
  "Buffer",
  "EventSource",
  "WebSocket",
  "XMLHttpRequest",
  "fetch",
  "process",
  "sendBeacon",
]);
const HOST_FORBIDDEN_PROPERTIES = new Set([...FORBIDDEN_GLOBALS, "sendBeacon"]);
const GLOBAL_HOSTS = new Set(["global", "globalThis", "navigator", "self", "window"]);
const HOST_CHILDREN = new Set(["globalThis", "navigator", "self", "window"]);

export function assertJavaScriptSecurity(path: string, source: string): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`JavaScript security parse failed: ${path}`);
  const analyzer = new RuntimeAnalyzer(file);
  analyzer.scan();
  if (analyzer.failures.size) {
    throw new Error(
      `Forbidden runtime primitive in ${path}: ${[...analyzer.failures].sort().join(", ")}`,
    );
  }
}

class RuntimeAnalyzer {
  readonly failures = new Set<string>();
  private readonly hosts = new Set(GLOBAL_HOSTS);
  private readonly dynamicCodeAliases = new Set<string>();
  constructor(private readonly file: ts.SourceFile) {}

  scan(): void {
    this.collectAliases();
    this.visit(this.file);
  }

  private collectAliases(): void {
    let changed = true;
    while (changed) {
      changed = false;
      const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
          changed = this.collectDeclaration(node.name, node.initializer) || changed;
        }
        if (isSimpleAssignment(node)) {
          changed = this.collectName(node.left.text, node.right) || changed;
        }
        ts.forEachChild(node, collect);
      };
      collect(this.file);
    }
  }

  private collectDeclaration(name: ts.BindingName, value: ts.Expression): boolean {
    if (ts.isIdentifier(name)) return this.collectName(name.text, value);
    if (!ts.isObjectBindingPattern(name) || !this.isHost(value)) return false;
    let changed = false;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const key = bindingKey(element);
      if (key && HOST_CHILDREN.has(key)) changed = add(this.hosts, element.name.text) || changed;
      if (key === "constructor")
        changed = add(this.dynamicCodeAliases, element.name.text) || changed;
    }
    return changed;
  }

  private collectName(name: string, value: ts.Expression): boolean {
    if (this.isHost(value)) return add(this.hosts, name);
    if (this.isDynamicCodeReference(value)) return add(this.dynamicCodeAliases, name);
    return false;
  }

  private visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) this.inspectIdentifier(node);
    if (ts.isPropertyAccessExpression(node)) this.inspectProperty(node);
    if (ts.isElementAccessExpression(node)) this.inspectElement(node);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) this.inspectInvocation(node);
    if (ts.isVariableDeclaration(node)) this.inspectBinding(node);
    if (isModuleNode(node)) this.inspectModule(node);
    ts.forEachChild(node, this.visit);
  };

  private inspectIdentifier(node: ts.Identifier): void {
    if (!FORBIDDEN_GLOBALS.has(node.text) || !isIdentifierReference(node)) return;
    if (node.text === "process" && ts.isTypeOfExpression(node.parent)) return;
    if (node.text === "Function" && isSafeFunctionReference(node)) return;
    this.failures.add(node.text);
  }

  private inspectProperty(node: ts.PropertyAccessExpression): void {
    if (
      FORBIDDEN_PROPERTIES.has(node.name.text) ||
      (this.isHost(node.expression) && HOST_FORBIDDEN_PROPERTIES.has(node.name.text))
    ) {
      this.failures.add(node.name.text);
    }
  }

  private inspectElement(node: ts.ElementAccessExpression): void {
    const key = staticString(node.argumentExpression);
    if (
      key !== undefined &&
      (FORBIDDEN_PROPERTIES.has(key) ||
        (this.isHost(node.expression) && HOST_FORBIDDEN_PROPERTIES.has(key)))
    ) {
      this.failures.add(key);
    }
    if (key === undefined && this.isHost(node.expression))
      this.failures.add("dynamic-global-access");
  }

  private inspectInvocation(node: ts.CallExpression | ts.NewExpression): void {
    const target = unwrapExpression(node.expression);
    if (this.isDynamicCodeReference(target)) this.failures.add("dynamic-code-constructor");
    if (isReflectConstruct(target)) this.failures.add("Reflect.construct");
    if (ts.isCallExpression(node) && target.kind === ts.SyntaxKind.ImportKeyword) {
      this.inspectDynamicImport(node);
    }
    if (ts.isCallExpression(node)) this.inspectReflectiveGlobalAccess(node, target);
  }

  private inspectDynamicImport(node: ts.CallExpression): void {
    const specifier = node.arguments[0] ? staticString(node.arguments[0]) : undefined;
    if (!specifier || !isBundledRelativeImport(specifier)) this.failures.add("dynamic-import");
  }

  private inspectReflectiveGlobalAccess(node: ts.CallExpression, target: ts.Expression): void {
    const operation = memberName(target);
    if (
      !operation ||
      !["get", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors"].includes(operation)
    ) {
      return;
    }
    const owner = memberOwnerName(target);
    if (!owner || !["Object", "Reflect"].includes(owner) || !node.arguments[0]) return;
    if (!this.isHost(node.arguments[0])) return;
    const key = node.arguments[1] ? staticString(node.arguments[1]) : undefined;
    if (key === undefined || HOST_FORBIDDEN_PROPERTIES.has(key))
      this.failures.add("reflective-global-access");
  }

  private inspectBinding(node: ts.VariableDeclaration): void {
    if (
      !node.initializer ||
      !ts.isObjectBindingPattern(node.name) ||
      !this.isHost(node.initializer)
    ) {
      return;
    }
    for (const element of node.name.elements) {
      const key = bindingKey(element);
      if (!key || HOST_FORBIDDEN_PROPERTIES.has(key) || element.dotDotDotToken) {
        this.failures.add("global-destructuring");
      }
    }
  }

  private inspectModule(node: ModuleNode): void {
    const value = staticString(node.moduleSpecifier);
    if (!value || !isBundledRelativeImport(value))
      this.failures.add(`module:${value ?? "dynamic"}`);
  }

  private isHost(value: ts.Expression): boolean {
    const expression = unwrapExpression(value);
    if (ts.isIdentifier(expression)) return this.hosts.has(expression.text);
    const name = memberName(expression);
    const owner = memberOwner(expression);
    return (
      name !== undefined && HOST_CHILDREN.has(name) && owner !== undefined && this.isHost(owner)
    );
  }

  private isDynamicCodeReference(value: ts.Expression): boolean {
    const expression = unwrapExpression(value);
    if (ts.isIdentifier(expression)) return this.dynamicCodeAliases.has(expression.text);
    const name = memberName(expression);
    if (name === "constructor") return true;
    if (["bind", "call", "apply"].includes(name ?? "")) {
      const owner = memberOwner(expression);
      return owner !== undefined && this.isDynamicCodeReference(owner);
    }
    if (ts.isCallExpression(expression) && isReflectGetConstructor(expression)) return true;
    return false;
  }
}

type ModuleNode = ts.ImportDeclaration | ts.ExportDeclaration;

function isModuleNode(node: ts.Node): node is ModuleNode {
  return (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined
  );
}

function isSimpleAssignment(node: ts.Node): node is ts.BinaryExpression & { left: ts.Identifier } {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  );
}

function isIdentifierReference(node: ts.Identifier): boolean {
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

function isSafeFunctionReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    parent.right === node
  ) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    parent.name.text === "prototype"
  );
}

function staticString(value: ts.Expression | undefined): string | undefined {
  if (!value) return undefined;
  const expression = unwrapExpression(value);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isTemplateExpression(expression)) return staticTemplate(expression);
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
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

function staticTemplate(value: ts.TemplateExpression): string | undefined {
  let result = value.head.text;
  for (const span of value.templateSpans) {
    const expression = staticString(span.expression);
    if (expression === undefined) return undefined;
    result += expression + span.literal.text;
  }
  return result;
}

function unwrapExpression(value: ts.Expression): ts.Expression {
  let expression = value;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return unwrapExpression(expression.right);
  }
  return expression;
}

function memberName(value: ts.Expression): string | undefined {
  const expression = unwrapExpression(value);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return staticString(expression.argumentExpression);
  return undefined;
}

function memberOwner(value: ts.Expression): ts.Expression | undefined {
  const expression = unwrapExpression(value);
  return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
    ? expression.expression
    : undefined;
}

function memberOwnerName(value: ts.Expression): string | undefined {
  const owner = memberOwner(value);
  const expression = owner && unwrapExpression(owner);
  return expression && ts.isIdentifier(expression) ? expression.text : undefined;
}

function bindingKey(element: ts.BindingElement): string | undefined {
  if (element.dotDotDotToken) return undefined;
  if (element.propertyName) {
    if (ts.isComputedPropertyName(element.propertyName))
      return staticString(element.propertyName.expression);
    return ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
      ? element.propertyName.text
      : undefined;
  }
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

function isReflectConstruct(value: ts.Expression): boolean {
  return memberOwnerName(value) === "Reflect" && memberName(value) === "construct";
}

function isReflectGetConstructor(value: ts.CallExpression): boolean {
  return (
    memberOwnerName(value.expression) === "Reflect" &&
    memberName(value.expression) === "get" &&
    staticString(value.arguments[1]) === "constructor"
  );
}

function isBundledRelativeImport(value: string): boolean {
  return /^\.\/[A-Za-z0-9_.-]+\.js$/u.test(value);
}

function add(values: Set<string>, value: string): boolean {
  const size = values.size;
  values.add(value);
  return values.size !== size;
}

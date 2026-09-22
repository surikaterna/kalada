import ts from "typescript";
import {
  type BindingContext,
  bindAssignment,
  bindName,
  ScopedBindings,
} from "./security-bindings.js";
import {
  type AbstractValue,
  arrayValue,
  descriptorValue,
  directFunctionValue,
  Flow,
  flowing,
  functionValue,
  hasCapabilityFlow,
  hasFlow,
  hasHostFlow,
  isLogicalOperator,
  keyValue,
  mergeAll,
  mergeValues,
  opaqueKey,
  SAFE,
  staticString,
  unwrapExpression,
} from "./security-flow.js";
import {
  CALL_WRAPPERS,
  FORBIDDEN_GLOBALS,
  FORBIDDEN_PROPERTIES,
  functionReturnExpressions,
  GLOBAL_HOSTS,
  HOST_CHILDREN,
  isAssignment,
  isBundledRelativeImport,
  isCallWrapper,
  isFunctionExpression,
  isIdentifierReference,
  isInvocation,
  isMemberExpression,
  isModuleNode,
  isSafeFunctionReference,
  isSecurityExpression,
  isSymbolFactory,
  type ModuleNode,
  moduleSpecifier,
} from "./security-policy.js";

const MAX_ARRAY = 32;
const MAX_BINDINGS = 20_000;
const MAX_DEPTH = 80;
const MAX_WORK = 2_000_000;

export class RuntimeAnalyzer {
  readonly failures = new Set<string>();
  private readonly bindings = new ScopedBindings(MAX_BINDINGS, (node) =>
    this.fail("binding cap exhausted", node),
  );
  private work = 0;
  private exhausted = false;
  private readonly bindingContext: BindingContext = {
    assign: (name, value, target) => this.bindings.assign(name, value, target),
    fail: (reason, node) => this.fail(reason, node),
    lookup: (owner, key, node) => this.lookup(owner, key, node),
  };

  constructor(
    private readonly file: ts.SourceFile,
    private readonly maxWork = MAX_WORK,
  ) {}

  scan(): void {
    this.propagate();
    this.visit(this.file);
    if (this.exhausted) this.failures.add("analysis work cap exhausted");
  }

  private propagate(): void {
    const collect = (node: ts.Node): void => {
      this.collectAlias(node);
      ts.forEachChild(node, collect);
    };
    collect(this.file);
  }

  private collectAlias(node: ts.Node): boolean {
    if (!this.spend()) return false;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = isFunctionExpression(node.initializer)
        ? functionValue(node.initializer)
        : this.value(node.initializer);
      return bindName(node.name, value, this.bindingContext);
    }
    if (ts.isParameter(node)) return bindName(node.name, SAFE, this.bindingContext);
    if (ts.isFunctionDeclaration(node) && node.name) {
      return this.bindings.assign(node.name.text, functionValue(node), node.name);
    }
    if (isAssignment(node)) {
      return bindAssignment(node.left, this.value(node.right), this.bindingContext);
    }
    return false;
  }

  private visit = (node: ts.Node): void => {
    if (!this.spend()) return;
    if (ts.isIdentifier(node)) this.inspectIdentifier(node);
    if (isSecurityExpression(node)) this.value(node);
    if (isModuleNode(node)) this.inspectModule(node);
    ts.forEachChild(node, this.visit);
  };

  private value(
    input: ts.Expression,
    locals: ReadonlyMap<string, AbstractValue> = new Map(),
    depth = 0,
  ): AbstractValue {
    if (!this.spend()) return flowing(Flow.UnknownHost);
    if (depth >= MAX_DEPTH) return this.depthFailure(input);
    const node = unwrapExpression(input);
    const next = depth + 1;
    if (ts.isIdentifier(node)) return this.identifierValue(node, locals);
    const literal = staticString(node);
    if (literal !== undefined) return keyValue(literal);
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) return SAFE;
    if (ts.isConditionalExpression(node)) {
      return mergeValues(
        this.value(node.whenTrue, locals, next),
        this.value(node.whenFalse, locals, next),
      );
    }
    if (ts.isBinaryExpression(node)) return this.binaryValue(node, locals, next);
    if (ts.isArrayLiteralExpression(node)) return this.array(node, locals, next);
    if (isMemberExpression(node)) return this.member(node, locals, next);
    if (isInvocation(node)) return this.call(node, locals, next);
    if (isFunctionExpression(node)) return directFunctionValue(node);
    if (ts.isAwaitExpression(node)) return this.value(node.expression, locals, next);
    return this.unsupported(node, locals, next);
  }

  private identifierValue(
    node: ts.Identifier,
    locals: ReadonlyMap<string, AbstractValue>,
  ): AbstractValue {
    const known = locals.get(node.text) ?? this.bindings.get(node.text, node);
    if (known) return known;
    if (GLOBAL_HOSTS.has(node.text)) return flowing(Flow.Host);
    if (node.text === "Reflect") return flowing(Flow.Reflect);
    if (node.text === "Object") return flowing(Flow.Object);
    return FORBIDDEN_GLOBALS.has(node.text) ? flowing(Flow.Forbidden) : SAFE;
  }

  private binaryValue(
    node: ts.BinaryExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      this.value(node.left, locals, depth);
      return this.value(node.right, locals, depth);
    }
    if (isLogicalOperator(node.operatorToken.kind)) {
      return mergeValues(
        this.value(node.left, locals, depth),
        this.value(node.right, locals, depth),
      );
    }
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
      return this.value(node.right, locals, depth);
    return SAFE;
  }

  private array(
    node: ts.ArrayLiteralExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    if (node.elements.length > MAX_ARRAY) return this.depthFailure(node);
    const elements = node.elements.map((element) => {
      if (!ts.isSpreadElement(element)) return this.value(element, locals, depth);
      const spread = this.value(element.expression, locals, depth);
      if (!hasCapabilityFlow(spread)) return SAFE;
      this.fail("unsupported capability array spread", element);
      return flowing(Flow.UnknownHost);
    });
    return elements.some(hasCapabilityFlow) ? arrayValue(elements) : SAFE;
  }

  private member(
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    const owner = this.value(node.expression, locals, depth);
    const key = ts.isPropertyAccessExpression(node)
      ? keyValue(node.name.text)
      : this.value(node.argumentExpression, locals, depth);
    return this.lookup(owner, key, node);
  }

  private lookup(owner: AbstractValue, key: AbstractValue, node: ts.Node): AbstractValue {
    const names = key.keys ?? [];
    const dynamic = !key.keyComplete;
    if (owner.elements) return this.arrayLookup(owner, names, dynamic, node);
    if (hasFlow(owner, Flow.Reflect)) return this.reflectMember(names, dynamic, node);
    if (hasFlow(owner, Flow.Object)) return this.objectMember(names, dynamic, node);
    if (owner.descriptor && names.includes("value")) return owner.descriptor;
    if (hasHostFlow(owner)) return this.hostMember(owner, names, dynamic, node);
    if (names.some((name) => CALL_WRAPPERS.has(name)) && owner.flow !== 0) return owner;
    if (names.includes("constructor")) return mergeValues(owner, flowing(Flow.Forbidden));
    return SAFE;
  }

  private arrayLookup(
    owner: AbstractValue,
    names: readonly string[],
    dynamic: boolean,
    node: ts.Node,
  ): AbstractValue {
    if (dynamic || names.length !== 1 || !/^\d+$/u.test(names[0] ?? "")) {
      if (owner.elements?.some(hasCapabilityFlow))
        this.fail("dynamic capability array index", node);
      return owner.elements?.some(hasCapabilityFlow) ? flowing(Flow.UnknownHost) : SAFE;
    }
    return owner.elements?.[Number(names[0])] ?? SAFE;
  }

  private hostMember(
    _owner: AbstractValue,
    names: readonly string[],
    dynamic: boolean,
    node: ts.Node,
  ): AbstractValue {
    if (dynamic) {
      this.fail("dynamic global-host property", node);
      return flowing(Flow.UnknownHost);
    }
    if (names.some((name) => FORBIDDEN_PROPERTIES.has(name))) {
      this.fail(`forbidden global-host property ${names.join("|")}`, node);
      return flowing(Flow.Forbidden);
    }
    if (names.length && names.every((name) => HOST_CHILDREN.has(name))) return flowing(Flow.Host);
    return flowing(Flow.HostDerived);
  }

  private reflectMember(names: readonly string[], dynamic: boolean, node: ts.Node): AbstractValue {
    if (dynamic) return this.unsupportedUtility("dynamic Reflect property", node);
    if (names.includes("get")) return flowing(Flow.ReflectGet);
    if (names.includes("construct")) return flowing(Flow.ReflectConstruct);
    return SAFE;
  }

  private objectMember(names: readonly string[], dynamic: boolean, node: ts.Node): AbstractValue {
    if (dynamic) return this.unsupportedUtility("dynamic Object reflection property", node);
    if (
      names.some((name) => ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors"].includes(name))
    ) {
      return flowing(Flow.DescriptorGet);
    }
    return SAFE;
  }

  private call(
    node: ts.CallExpression | ts.NewExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return this.dynamicImport(node);
    }
    if (ts.isCallExpression(node) && isSymbolFactory(node.expression)) return opaqueKey();
    const callee = this.value(node.expression, locals, depth);
    if (hasFlow(callee, Flow.Forbidden)) this.fail("forbidden dynamic invocation", node);
    if (hasFlow(callee, Flow.UnknownHost) || hasFlow(callee, Flow.Host)) {
      this.fail("unprovable global-host invocation", node);
    }
    if (hasFlow(callee, Flow.ReflectConstruct)) this.fail("Reflect.construct", node);
    if (
      ts.isCallExpression(node) &&
      isCallWrapper(node.expression) &&
      (hasFlow(callee, Flow.ReflectGet) || hasFlow(callee, Flow.DescriptorGet))
    ) {
      this.fail("reflection utility call/apply/bind wrapper", node);
    }
    if (hasFlow(callee, Flow.ReflectGet)) return this.reflectGet(node, locals, depth);
    if (hasFlow(callee, Flow.DescriptorGet)) return this.descriptorGet(node, locals, depth);
    if (callee.functions?.length) return this.functionReturn(callee, node.arguments, locals, depth);
    return SAFE;
  }

  private reflectGet(
    node: ts.CallExpression | ts.NewExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    const owner = node.arguments[0] ? this.value(node.arguments[0], locals, depth) : SAFE;
    const key = node.arguments[1] ? this.value(node.arguments[1], locals, depth) : SAFE;
    if (key.keys?.includes("constructor")) return flowing(Flow.Forbidden);
    if (!hasHostFlow(owner)) return SAFE;
    return this.lookup(owner, key, node);
  }

  private descriptorGet(
    node: ts.CallExpression | ts.NewExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    const value = this.reflectGet(node, locals, depth);
    return descriptorValue(value);
  }

  private functionReturn(
    callee: AbstractValue,
    args: readonly ts.Expression[],
    outer: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    const returns: AbstractValue[] = [];
    for (const fn of callee.functions ?? []) {
      const locals = new Map(outer);
      fn.parameters.forEach((parameter, index) => {
        if (ts.isIdentifier(parameter.name) && args[index]) {
          locals.set(parameter.name.text, this.value(args[index], outer, depth));
        }
      });
      for (const expression of functionReturnExpressions(fn)) {
        returns.push(this.value(expression, locals, depth));
      }
    }
    return mergeAll(returns);
  }

  private unsupported(
    node: ts.Expression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    const children: AbstractValue[] = [];
    ts.forEachChild(node, (child) => {
      if (ts.isExpression(child)) children.push(this.value(child, locals, depth));
    });
    const merged = mergeAll(children);
    return hasCapabilityFlow(merged) ? flowing(Flow.UnknownHost) : SAFE;
  }

  private inspectIdentifier(node: ts.Identifier): void {
    if (!FORBIDDEN_GLOBALS.has(node.text) || !isIdentifierReference(node)) return;
    if (node.text === "process" && ts.isTypeOfExpression(node.parent)) return;
    if (node.text === "Function" && isSafeFunctionReference(node)) return;
    this.fail(`forbidden global ${node.text}`, node);
  }

  private inspectModule(node: ModuleNode): void {
    const value = moduleSpecifier(node);
    if (!value || !isBundledRelativeImport(value))
      this.fail(`forbidden module ${value ?? "dynamic"}`, node);
  }

  private dynamicImport(node: ts.CallExpression): AbstractValue {
    const specifier = staticString(node.arguments[0]);
    if (!specifier || !isBundledRelativeImport(specifier))
      this.fail("dynamic or non-relative import", node);
    return SAFE;
  }

  private unsupportedUtility(reason: string, node: ts.Node): AbstractValue {
    this.fail(reason, node);
    return flowing(Flow.UnknownHost);
  }

  private depthFailure(node: ts.Node): AbstractValue {
    this.fail("analysis depth cap exhausted", node);
    return flowing(Flow.UnknownHost);
  }

  private fail(reason: string, node: ts.Node): void {
    const position = this.file.getLineAndCharacterOfPosition(node.getStart(this.file));
    const source = node.getText(this.file).replace(/\s+/gu, " ").slice(0, 100);
    this.failures.add(`${reason} at ${position.line + 1}:${position.character + 1} (${source})`);
  }

  private spend(): boolean {
    this.work += 1;
    if (this.work <= this.maxWork) return true;
    this.exhausted = true;
    return false;
  }
}

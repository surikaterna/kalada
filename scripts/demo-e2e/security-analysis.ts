import ts from "typescript";
import {
  type BindingContext,
  bindAssignment,
  bindName,
  ScopedBindings,
} from "./security-bindings.js";
import {
  boundCallableValue,
  classMethodValue,
  hostInvocationResult,
  hostMemberValue,
  inspectInvocation,
  isApprovedHostInvocation,
  isSpecialConstructorOwner,
  objectLiteralValue,
  objectMemberValue,
  ownPropertyValue,
  reflectMemberValue,
  timerCallValue,
} from "./security-capabilities.js";
import {
  type AbstractValue,
  arrayValue,
  Flow,
  flowing,
  hasCapabilityFlow,
  hasFlow,
  hasHostFlow,
  hostValue,
  isInertLiteralArray,
  isLogicalOperator,
  keyValue,
  mergeAll,
  mergeValues,
  opaqueKey,
  SAFE,
  staticString,
  unwrapExpression,
} from "./security-flow.js";
import { closeFunction, FunctionSummarizer } from "./security-functions.js";
import {
  AMBIENT_TIMERS,
  CALL_WRAPPERS,
  FORBIDDEN_GLOBALS,
  GLOBAL_HOSTS,
  type InvocationNode,
  isAssignment,
  isBundledRelativeImport,
  isFunctionExpression,
  isInvocation,
  isMemberExpression,
  isModuleNode,
  isSecurityExpression,
  isSymbolFactory,
  type ModuleNode,
  moduleSpecifier,
} from "./security-policy.js";
import { reflectionCallValue } from "./security-reflection.js";

const MAX_ARRAY = 32;
const MAX_BINDINGS = 20_000;
const MAX_DEPTH = 80;
const MAX_PASSES = 16;
const MAX_WORK = 8_000_000;
export class RuntimeAnalyzer {
  readonly failures = new Set<string>();
  private readonly bindings = new ScopedBindings(MAX_BINDINGS, (node) =>
    this.fail("binding cap exhausted", node),
  );
  private work = 0;
  private exhausted = false;
  private readonly bindingContext: BindingContext = {
    assign: (name, value, target) => this.bindings.assign(name, value, target),
    defaultValue: (expression) => this.value(expression),
    fail: (reason, node) => this.fail(reason, node),
    lookup: (owner, key, node) => this.lookup(owner, key, node),
  };
  private readonly functions = new FunctionSummarizer(
    (expression, locals, depth) => this.value(expression, locals, depth),
    (node, locals) => this.closureValue(node, locals),
    (owner, key, node) => this.lookup(owner, key, node),
    (reason, node) => this.fail(reason, node),
  );

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
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let changed = false;
      const collect = (node: ts.Node): void => {
        changed = this.collectAlias(node) || changed;
        ts.forEachChild(node, collect);
      };
      collect(this.file);
      if (!changed || this.exhausted) return;
    }
    this.fail("binding fixed-point cap exhausted", this.file);
  }

  private collectAlias(node: ts.Node): boolean {
    if (!this.spend()) return false;
    const named = this.collectNamedDeclaration(node);
    if (named !== undefined) return named;
    if (ts.isVariableDeclaration(node)) {
      const value =
        node.initializer && isFunctionExpression(node.initializer)
          ? this.closureValue(node.initializer)
          : node.initializer
            ? this.value(node.initializer)
            : SAFE;
      return bindName(node.name, value, this.bindingContext);
    }
    if (ts.isParameter(node)) return bindName(node.name, SAFE, this.bindingContext);
    if (isAssignment(node)) {
      return bindAssignment(node.left, this.value(node.right), this.bindingContext);
    }
    return false;
  }

  private collectNamedDeclaration(node: ts.Node): boolean | undefined {
    if (ts.isFunctionDeclaration(node) && node.name) {
      return this.bindings.declare(node.name.text, this.closureValue(node), node);
    }
    if (ts.isFunctionExpression(node) && node.name) {
      return this.bindings.declareAt(node.name.text, SAFE, node, node.name);
    }
    if (ts.isClassDeclaration(node) && node.name) {
      return this.bindings.declare(node.name.text, SAFE, node);
    }
    if (ts.isClassExpression(node) && node.name) {
      return this.bindings.declareAt(node.name.text, SAFE, node, node.name);
    }
    return undefined;
  }

  private visit = (node: ts.Node): void => {
    if (!this.spend()) return;
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
    const declaration = this.declarationExpression(node, locals, next);
    if (declaration) return declaration;
    if (isMemberExpression(node)) return this.member(node, locals, next);
    if (isInvocation(node)) return this.call(node, locals, next);
    if (ts.isAwaitExpression(node)) return this.value(node.expression, locals, next);
    if (ts.isYieldExpression(node) && node.expression)
      return this.value(node.expression, locals, next);
    return this.unsupported(node, locals, next);
  }

  private declarationExpression(
    node: ts.Expression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue | undefined {
    if (isFunctionExpression(node)) return this.closureValue(node, locals);
    if (ts.isClassExpression(node)) return SAFE;
    if (!ts.isObjectLiteralExpression(node)) return undefined;
    return objectLiteralValue(
      node,
      (expression) => this.value(expression, locals, depth),
      (fn) => this.closureValue(fn, locals),
    );
  }

  private identifierValue(
    node: ts.Identifier,
    locals: ReadonlyMap<string, AbstractValue>,
  ): AbstractValue {
    const known = locals.get(node.text) ?? this.bindings.get(node.text, node);
    if (known) return known;
    if (GLOBAL_HOSTS.has(node.text)) return hostValue(node.text);
    if (node.text === "Reflect") return flowing(Flow.Reflect);
    if (node.text === "Object") return flowing(Flow.Object);
    if (AMBIENT_TIMERS.has(node.text)) return flowing(Flow.Timer);
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
    if (node.elements.length > MAX_ARRAY) {
      return isInertLiteralArray(node) ? SAFE : this.depthFailure(node);
    }
    const elements = node.elements.map((element) => {
      if (!ts.isSpreadElement(element)) return this.value(element, locals, depth);
      const spread = this.value(element.expression, locals, depth);
      if (!hasCapabilityFlow(spread)) return SAFE;
      this.fail("unsupported capability array spread", element);
      return flowing(Flow.UnknownHost);
    });
    return elements.some((value) => hasCapabilityFlow(value) || value.callableSafe)
      ? arrayValue(elements)
      : SAFE;
  }

  private member(
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    const method = classMethodValue(node, (fn) => this.closureValue(fn, locals));
    if (method) return method;
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
    const own = ownPropertyValue(owner, names, dynamic);
    if (own) return own;
    if (names.includes("constructor")) {
      if (isSpecialConstructorOwner(owner)) {
        this.fail("constructor capability access", node);
        return flowing(Flow.Forbidden);
      }
      return flowing(Flow.ConstructorPotential);
    }
    const fail = (reason: string, target: ts.Node) => this.fail(reason, target);
    if (hasFlow(owner, Flow.Reflect)) return reflectMemberValue(names, dynamic, node, fail);
    if (hasFlow(owner, Flow.Object)) return objectMemberValue(names, dynamic, node, fail);
    if (owner.descriptor && names.includes("value")) return owner.descriptor;
    if (hasHostFlow(owner)) {
      return hostMemberValue(owner, names, dynamic, node, (reason, target) =>
        this.fail(reason, target),
      );
    }
    if (names.some((name) => CALL_WRAPPERS.has(name)) && (owner.flow !== 0 || owner.callableSafe)) {
      return owner;
    }
    return SAFE;
  }

  private arrayLookup(
    owner: AbstractValue,
    names: readonly string[],
    dynamic: boolean,
    node: ts.Node,
  ): AbstractValue {
    if (!dynamic && names.length === 1) {
      const name = names[0] ?? "";
      if (/^\d+$/u.test(name)) return owner.elements?.[Number(name)] ?? SAFE;
      if (name === "constructor") return flowing(Flow.ConstructorPotential);
      return SAFE;
    }
    if (dynamic || names.length !== 1) {
      if (owner.elements?.some(hasCapabilityFlow))
        this.fail("dynamic capability array index", node);
      return owner.elements?.some(hasCapabilityFlow) ? flowing(Flow.UnknownHost) : SAFE;
    }
    return SAFE;
  }

  private call(
    node: InvocationNode,
    locals: ReadonlyMap<string, AbstractValue>,
    depth: number,
  ): AbstractValue {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return this.dynamicImport(node);
    }
    if (ts.isCallExpression(node) && isSymbolFactory(node.expression)) return opaqueKey();
    const target = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
    const callee = this.value(target, locals, depth);
    const args = ts.isTaggedTemplateExpression(node) ? [] : (node.arguments ?? []);
    const argumentValues = args.map((argument) => this.value(argument, locals, depth));
    inspectInvocation(callee, node, argumentValues, (reason, target) => this.fail(reason, target));
    const reflection = reflectionCallValue(
      callee,
      node,
      argumentValues,
      (owner, key, target) => this.lookup(owner, key, target),
      (reason, target) => this.fail(reason, target),
    );
    if (reflection) return reflection;
    if (hasFlow(callee, Flow.Timer) || hasFlow(callee, Flow.BoundTimer)) {
      return timerCallValue(node, callee, argumentValues, (reason, target) =>
        this.fail(reason, target),
      );
    }
    const boundCallable = boundCallableValue(callee, node);
    if (boundCallable) return boundCallable;
    if (callee.functions?.length) return this.functions.summarize(callee, argumentValues, depth);
    const argumentsFlow = mergeAll(argumentValues);
    if (isApprovedHostInvocation(callee, node, argumentValues)) return hostInvocationResult(callee);
    if (hasHostFlow(callee)) return flowing(Flow.HostDerived);
    return hasCapabilityFlow(argumentsFlow) ? flowing(Flow.UnknownHost) : SAFE;
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

  private closureValue(
    node: ts.FunctionLikeDeclaration,
    locals: ReadonlyMap<string, AbstractValue> = new Map(),
  ): AbstractValue {
    return closeFunction(node, locals, (name, target) => this.bindings.get(name, target));
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

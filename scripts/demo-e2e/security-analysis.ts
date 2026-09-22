import ts from "typescript";
import {
  type BindingContext,
  bindAssignment,
  bindName,
  ScopedBindings,
} from "./security-bindings.js";
import {
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
  regexMemberValue,
  timerCallValue,
} from "./security-capabilities.js";
import {
  arrayExpressionValue,
  binaryExpressionValue,
  forwardedExpression,
} from "./security-expressions.js";
import {
  type AbstractValue,
  Flow,
  flowing,
  hasCapabilityFlow,
  hasFlow,
  hasHostFlow,
  hostValue,
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
  evaluateArguments,
  isWrappable,
  resolveInvocation,
  wrapperValue,
} from "./security-invocation.js";
import {
  inspectMutationNode,
  inspectMutationTarget,
  inspectUtilityMutation,
} from "./security-mutations.js";
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

export class RuntimeAnalyzer {
  readonly failures = new Set<string>();
  private readonly bindings = new ScopedBindings(20_000, (node) =>
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
    private readonly maxWork = 8_000_000,
  ) {}

  scan(): void {
    this.propagate();
    this.visit(this.file);
    if (this.exhausted) this.failures.add("analysis work cap exhausted");
  }

  private propagate(): void {
    for (let pass = 0; pass < 16; pass += 1) {
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
            : { flow: 0, uninitialized: true };
      return bindName(node.name, value, this.bindingContext);
    }
    if (ts.isParameter(node)) return bindName(node.name, SAFE, this.bindingContext);
    if (isAssignment(node)) {
      const value = this.value(node.right);
      inspectMutationTarget(
        node.left,
        value,
        (target) => this.value(target),
        (reason, target) => this.fail(reason, target),
      );
      return bindAssignment(node.left, value, this.bindingContext);
    }
    inspectMutationNode(
      node,
      (target) => this.value(target),
      (reason, target) => this.fail(reason, target),
    );
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
    if (depth >= 80) return this.depthFailure(input);
    const node = unwrapExpression(input);
    const next = depth + 1;
    if (ts.isIdentifier(node)) return this.identifierValue(node, locals);
    if (ts.isRegularExpressionLiteral(node)) return { flow: 0, regex: true };
    const literal = staticString(node);
    if (literal !== undefined) return keyValue(literal);
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) return SAFE;
    if (ts.isConditionalExpression(node)) {
      return mergeValues(
        this.value(node.whenTrue, locals, next),
        this.value(node.whenFalse, locals, next),
      );
    }
    if (ts.isBinaryExpression(node)) {
      return binaryExpressionValue(node, (expression) => this.value(expression, locals, next));
    }
    if (ts.isArrayLiteralExpression(node)) {
      return arrayExpressionValue(
        node,
        32,
        (expression) => this.value(expression, locals, next),
        (target) => this.depthFailure(target),
      );
    }
    const declaration = this.declarationExpression(node, locals, next);
    if (declaration) return declaration;
    if (isMemberExpression(node)) return this.member(node, locals, next);
    if (isInvocation(node)) return this.call(node, locals, next);
    const forwarded = forwardedExpression(node);
    if (forwarded) return this.value(forwarded, locals, next);
    if (ts.isDeleteExpression(node)) return SAFE;
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
    const regexMember = regexMemberValue(owner, names);
    if (regexMember) return regexMember;
    if (names.includes("constructor")) {
      if (isSpecialConstructorOwner(owner)) {
        this.fail("constructor capability access", node);
        return flowing(Flow.Forbidden);
      }
      return flowing(Flow.ConstructorPotential);
    }
    if (names.length === 1 && CALL_WRAPPERS.has(names[0] ?? "") && isWrappable(owner)) {
      return wrapperValue(owner, names[0] as "apply" | "bind" | "call");
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
    const unresolved = this.value(target, locals, depth);
    const evaluated = evaluateArguments(node, (argument) => this.value(argument, locals, depth));
    const resolution = resolveInvocation(
      unresolved,
      node,
      evaluated.args,
      evaluated.argumentNodes,
      evaluated.argumentsExact,
      (reason, target) => this.fail(reason, target),
    );
    if ("result" in resolution) return resolution.result;
    const { callee, ...shape } = resolution.invocation;
    inspectInvocation(callee, shape, (reason, target) => this.fail(reason, target));
    const mutation = inspectUtilityMutation(callee, shape, (reason, target) =>
      this.fail(reason, target),
    );
    if (mutation) return mutation;
    const reflection = reflectionCallValue(
      callee,
      shape,
      (owner, key, target) => this.lookup(owner, key, target),
      (reason, target) => this.fail(reason, target),
    );
    if (reflection) return reflection;
    if (hasFlow(callee, Flow.Timer) || hasFlow(callee, Flow.BoundTimer)) {
      return timerCallValue(shape, callee, (reason, target) => this.fail(reason, target));
    }
    if (callee.functions?.length) return this.functions.summarize(callee, shape.args, depth);
    const argumentsFlow = mergeAll(shape.args);
    if (isApprovedHostInvocation(callee, shape)) return hostInvocationResult(callee);
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

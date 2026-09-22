import ts from "typescript";
import { type BindingContext, bindAssignment, bindName } from "./security-bindings.js";
import {
  type AbstractValue,
  arrayValue,
  capabilityCaptures,
  directFunctionValue,
  Flow,
  type FunctionClosure,
  flowing,
  hasCallableCapability,
  hasCapabilityFlow,
  mergeAll,
  mergeCaptureMaps,
  mergeValues,
  SAFE,
  staticString,
} from "./security-flow.js";
import {
  FORBIDDEN_PROPERTIES,
  GLOBAL_HOSTS,
  HOST_CHILDREN,
  isAssignment,
  isIdentifierReference,
} from "./security-policy.js";

type Evaluate = (
  expression: ts.Expression,
  locals: ReadonlyMap<string, AbstractValue>,
  depth: number,
) => AbstractValue;
type CloseFunction = (
  node: ts.FunctionLikeDeclaration,
  locals: ReadonlyMap<string, AbstractValue>,
) => AbstractValue;
type ResolveBinding = (name: string, target: ts.Node) => AbstractValue | undefined;

export function closeFunction(
  node: ts.FunctionLikeDeclaration,
  locals: ReadonlyMap<string, AbstractValue>,
  resolve: ResolveBinding,
): AbstractValue {
  const lexical = new Map<string, AbstractValue>();
  const localNames = functionLocalNames(node);
  let capabilitySource = false;
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && isIdentifierReference(child)) {
      const value = resolve(child.text, child);
      if (
        !localNames.has(child.text) &&
        value &&
        (hasCapabilityFlow(value) || hasCallableCapability(value))
      ) {
        lexical.set(child.text, value);
      }
      if (!value && GLOBAL_HOSTS.has(child.text) && !isSafeStaticHostUse(child)) {
        capabilitySource = true;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  const captures = mergeCaptureMaps(capabilityCaptures(locals), lexical);
  return directFunctionValue(node, captures, capabilitySource);
}

function functionLocalNames(node: ts.FunctionLikeDeclaration): ReadonlySet<string> {
  const names = new Set<string>();
  for (const parameter of node.parameters) collectBindingNames(parameter.name, names);
  const visit = (child: ts.Node): void => {
    if (child !== node && ts.isFunctionLike(child)) {
      if (ts.isFunctionDeclaration(child) && child.name) names.add(child.name.text);
      return;
    }
    if (ts.isVariableDeclaration(child)) collectBindingNames(child.name, names);
    if (ts.isClassDeclaration(child) && child.name) names.add(child.name.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) collectBindingNames(element.name, names);
}

function isSafeStaticHostUse(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isTypeOfExpression(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return isSafeHostKey(parent.name.text);
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const key = staticString(parent.argumentExpression);
    return key !== undefined && isSafeHostKey(key);
  }
  return false;
}

function isSafeHostKey(key: string): boolean {
  return !FORBIDDEN_PROPERTIES.has(key) && !HOST_CHILDREN.has(key);
}

export class FunctionSummarizer {
  constructor(
    private readonly evaluate: Evaluate,
    private readonly closeFunction: CloseFunction,
    private readonly lookup: BindingContext["lookup"],
    private readonly fail: BindingContext["fail"],
  ) {}

  summarize(callee: AbstractValue, args: readonly AbstractValue[], depth: number): AbstractValue {
    const returns = (callee.functions ?? []).map((closure) => {
      if (!participatesInCapabilityFlow(closure, args)) return SAFE;
      if (!closure.bounded) return flowing(Flow.UnknownHost);
      return this.summarizeClosure(closure, args, depth);
    });
    return mergeAll(returns);
  }

  private summarizeClosure(
    closure: FunctionClosure,
    args: readonly AbstractValue[],
    depth: number,
  ): AbstractValue {
    const locals = new Map(closure.captures ?? []);
    const context = this.localContext(locals, depth);
    this.bindParameters(closure.node.parameters, args, locals, context, depth);
    const body = closure.node.body;
    if (!body) return this.unsupportedResult(locals);
    if (!ts.isBlock(body)) return this.evaluate(body, locals, depth);
    return this.executeBlock(body, locals, context, depth);
  }

  private bindParameters(
    parameters: readonly ts.ParameterDeclaration[],
    args: readonly AbstractValue[],
    locals: Map<string, AbstractValue>,
    context: BindingContext,
    depth: number,
  ): void {
    parameters.forEach((parameter, index) => {
      let value = parameter.dotDotDotToken ? arrayValue(args.slice(index)) : args[index];
      if (!value && parameter.initializer) {
        value = this.evaluate(parameter.initializer, locals, depth);
      }
      bindName(parameter.name, value ?? SAFE, context);
    });
  }

  private executeBlock(
    body: ts.Block,
    locals: Map<string, AbstractValue>,
    context: BindingContext,
    depth: number,
  ): AbstractValue {
    const returns: AbstractValue[] = [];
    for (const statement of body.statements) {
      if (ts.isVariableStatement(statement)) {
        this.executeDeclarations(statement.declarationList.declarations, locals, context, depth);
      } else if (ts.isExpressionStatement(statement) && isAssignment(statement.expression)) {
        const value = this.evaluate(statement.expression.right, locals, depth);
        bindAssignment(statement.expression.left, value, context);
      } else if (ts.isFunctionDeclaration(statement) && statement.name) {
        context.assign(statement.name.text, this.closeFunction(statement, locals), statement.name);
      } else if (ts.isReturnStatement(statement) && statement.expression) {
        returns.push(this.evaluate(statement.expression, locals, depth));
      } else if (!ts.isEmptyStatement(statement)) {
        returns.push(this.unsupportedResult(locals));
      }
    }
    return mergeAll(returns);
  }

  private executeDeclarations(
    declarations: readonly ts.VariableDeclaration[],
    locals: Map<string, AbstractValue>,
    context: BindingContext,
    depth: number,
  ): void {
    for (const declaration of declarations) {
      const value = declaration.initializer
        ? this.evaluate(declaration.initializer, locals, depth)
        : SAFE;
      bindName(declaration.name, value, context);
    }
  }

  private localContext(locals: Map<string, AbstractValue>, depth: number): BindingContext {
    return {
      assign: (name, value) => {
        const merged = mergeValues(locals.get(name) ?? SAFE, value);
        locals.set(name, merged);
        return true;
      },
      defaultValue: (expression) => this.evaluate(expression, locals, depth),
      fail: this.fail,
      lookup: this.lookup,
    };
  }

  private unsupportedResult(locals: ReadonlyMap<string, AbstractValue>): AbstractValue {
    if (
      [...locals.values()].some((value) => hasCapabilityFlow(value) || hasCallableCapability(value))
    ) {
      return flowing(Flow.UnknownHost);
    }
    return SAFE;
  }
}

function participatesInCapabilityFlow(
  closure: FunctionClosure,
  args: readonly AbstractValue[],
): boolean {
  return (
    closure.capabilitySource === true ||
    args.some((value) => hasCapabilityFlow(value) || hasCallableCapability(value)) ||
    (closure.captures
      ? [...closure.captures.values()].some(
          (value) => hasCapabilityFlow(value) || hasCallableCapability(value),
        )
      : false)
  );
}

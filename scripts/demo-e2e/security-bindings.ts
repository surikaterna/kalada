import ts from "typescript";
import {
  type AbstractValue,
  BOTTOM,
  Flow,
  flowing,
  hasCapabilityFlow,
  hasHostFlow,
  keyValue,
  mergeValues,
  SAFE,
  staticString,
  unwrapExpression,
  valueSignature,
} from "./security-flow.js";
import { isDeclarationBinding, lexicalScope, parentScope } from "./security-policy.js";

export interface BindingContext {
  readonly assign: (name: string, value: AbstractValue, target: ts.Node) => boolean;
  readonly defaultValue?: (expression: ts.Expression) => AbstractValue;
  readonly fail: (reason: string, node: ts.Node) => void;
  readonly lookup: (owner: AbstractValue, key: AbstractValue, node: ts.Node) => AbstractValue;
}

export class ScopedBindings {
  private readonly scopes = new Map<ts.Node, Map<string, AbstractValue>>();
  private count = 0;

  constructor(
    private readonly max: number,
    private readonly exhausted: (target: ts.Node) => void,
  ) {}

  get(name: string, target: ts.Node): AbstractValue | undefined {
    let scope: ts.Node | undefined = lexicalScope(target);
    while (scope) {
      const value = this.scopes.get(scope)?.get(name);
      if (value) return value;
      scope = parentScope(scope);
    }
    return undefined;
  }

  assign(name: string, value: AbstractValue, target: ts.Node): boolean {
    const scope = this.assignmentScope(name, target);
    return this.merge(scope, name, value, target);
  }

  declare(name: string, value: AbstractValue, target: ts.Node): boolean {
    return this.merge(lexicalScope(target), name, value, target);
  }

  private merge(scope: ts.Node, name: string, value: AbstractValue, target: ts.Node): boolean {
    const bindings = this.scopeBindings(scope);
    const current = bindings.get(name) ?? BOTTOM;
    const merged = mergeValues(current, value);
    if (valueSignature(current) === valueSignature(merged)) return false;
    if (!bindings.has(name) && this.count >= this.max) {
      this.exhausted(target);
      return false;
    }
    if (!bindings.has(name)) this.count += 1;
    bindings.set(name, merged);
    return true;
  }

  private assignmentScope(name: string, target: ts.Node): ts.Node {
    if (isDeclarationBinding(target)) return lexicalScope(target);
    let scope: ts.Node | undefined = lexicalScope(target);
    while (scope) {
      if (this.scopes.get(scope)?.has(name)) return scope;
      scope = parentScope(scope);
    }
    return target.getSourceFile();
  }

  private scopeBindings(scope: ts.Node): Map<string, AbstractValue> {
    const known = this.scopes.get(scope);
    if (known) return known;
    const created = new Map<string, AbstractValue>();
    this.scopes.set(scope, created);
    return created;
  }
}

export function bindName(
  name: ts.BindingName,
  value: AbstractValue,
  context: BindingContext,
): boolean {
  if (ts.isIdentifier(name)) return context.assign(name.text, value, name);
  if (ts.isArrayBindingPattern(name)) return bindArrayPattern(name, value, context);
  let changed = false;
  for (const element of name.elements) {
    if (element.dotDotDotToken) {
      if (hasHostFlow(value)) context.fail("global-host destructuring rest", element);
      continue;
    }
    const key = bindingKey(element);
    let selected = key ? context.lookup(value, keyValue(key), element) : flowing(Flow.UnknownHost);
    if (element.initializer && context.defaultValue) {
      selected = mergeValues(selected, context.defaultValue(element.initializer));
    }
    changed = bindName(element.name, selected, context) || changed;
  }
  return changed;
}

export function bindAssignment(
  name: ts.Expression,
  value: AbstractValue,
  context: BindingContext,
): boolean {
  const target = unwrapExpression(name);
  if (ts.isIdentifier(target)) return context.assign(target.text, value, target);
  if (ts.isObjectLiteralExpression(target)) return bindObjectAssignment(target, value, context);
  if (ts.isArrayLiteralExpression(target)) return bindArrayAssignment(target, value, context);
  return false;
}

function bindArrayPattern(
  name: ts.ArrayBindingPattern,
  value: AbstractValue,
  context: BindingContext,
): boolean {
  let changed = false;
  name.elements.forEach((element, index) => {
    if (!ts.isBindingElement(element)) return;
    const selected = selectIndex(value, index);
    changed = bindName(element.name, selected, context) || changed;
  });
  return changed;
}

function bindObjectAssignment(
  pattern: ts.ObjectLiteralExpression,
  value: AbstractValue,
  context: BindingContext,
): boolean {
  let changed = false;
  for (const property of pattern.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (hasHostFlow(value)) context.fail("global-host destructuring rest", property);
      continue;
    }
    const target = assignmentTarget(property);
    const key = assignmentKey(property);
    if (!target || !key) {
      if (hasHostFlow(value)) context.fail("unsupported global-host destructuring", property);
      continue;
    }
    const selected = context.lookup(value, keyValue(key), property);
    changed = bindAssignment(target, selected, context) || changed;
  }
  return changed;
}

function bindArrayAssignment(
  pattern: ts.ArrayLiteralExpression,
  value: AbstractValue,
  context: BindingContext,
): boolean {
  let changed = false;
  pattern.elements.forEach((element, index) => {
    if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) return;
    changed = bindAssignment(element, selectIndex(value, index), context) || changed;
  });
  return changed;
}

function selectIndex(value: AbstractValue, index: number): AbstractValue {
  return value.elements?.[index] ?? (hasCapabilityFlow(value) ? flowing(Flow.UnknownHost) : SAFE);
}

function bindingKey(element: ts.BindingElement): string | undefined {
  if (element.propertyName) {
    if (ts.isComputedPropertyName(element.propertyName)) {
      return staticString(element.propertyName.expression);
    }
    return element.propertyName.text;
  }
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

function assignmentKey(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (!ts.isPropertyAssignment(property)) return undefined;
  if (ts.isComputedPropertyName(property.name)) return staticString(property.name.expression);
  return property.name.text;
}

function assignmentTarget(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

import ts from "typescript";
import {
  type AbstractValue,
  hasCallableCapability,
  hasCapabilityFlow,
  hasHostFlow,
  SAFE,
  unwrapExpression,
} from "./security-flow.js";
import type { InvocationShape } from "./security-invocation.js";
import { isMutationAssignment } from "./security-policy.js";

type Evaluate = (expression: ts.Expression) => AbstractValue;
type Fail = (reason: string, node: ts.Node) => void;

export function inspectMutationTarget(
  target: ts.Expression,
  assigned: AbstractValue,
  evaluate: Evaluate,
  fail: Fail,
): void {
  const value = unwrapExpression(target);
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    inspectMemberWrite(value, assigned, evaluate, fail);
    return;
  }
  if (ts.isObjectLiteralExpression(value)) {
    inspectObjectTargets(value, assigned, evaluate, fail);
    return;
  }
  if (ts.isArrayLiteralExpression(value)) inspectArrayTargets(value, assigned, evaluate, fail);
}

export function inspectMutationNode(node: ts.Node, evaluate: Evaluate, fail: Fail): void {
  if (ts.isDeleteExpression(node)) {
    inspectMutationTarget(node.expression, SAFE, evaluate, fail);
    return;
  }
  if (isMutationAssignment(node)) {
    inspectMutationTarget(node.left, evaluate(node.right), evaluate, fail);
    return;
  }
  if (!ts.isPrefixUnaryExpression(node) && !ts.isPostfixUnaryExpression(node)) return;
  if (
    node.operator === ts.SyntaxKind.PlusPlusToken ||
    node.operator === ts.SyntaxKind.MinusMinusToken
  ) {
    inspectMutationTarget(node.operand, SAFE, evaluate, fail);
  }
}

export function inspectUtilityMutation(
  callee: AbstractValue,
  shape: InvocationShape,
  fail: Fail,
): AbstractValue | undefined {
  if (!callee.mutator) return undefined;
  const target = shape.args[0] ?? SAFE;
  const sources = mutationSources(callee, shape);
  if (isSpecialOwner(target)) fail(`${callee.mutator} on capability object`, shape.node);
  if (isAggregate(target) && (isSensitive(target) || sources.some(isSensitive))) {
    fail(`${callee.mutator} invalidates capability aggregate`, shape.node);
  }
  return target;
}

function mutationSources(callee: AbstractValue, shape: InvocationShape): readonly AbstractValue[] {
  if (callee.mutator === "assign") return shape.args.slice(1);
  if (callee.mutator === "reflectSet") return shape.args.slice(2, 3);
  return shape.args.slice(2);
}

function inspectMemberWrite(
  target: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  assigned: AbstractValue,
  evaluate: Evaluate,
  fail: Fail,
): void {
  const owner = evaluate(target.expression);
  if (isSpecialOwner(owner)) {
    if (isAllowedOpaqueHostWrite(owner, target, evaluate)) return;
    fail("write to capability object", target);
    return;
  }
  if (owner.functions && isSensitive(assigned)) {
    fail("capability function mutation", target);
    return;
  }
  if (isAggregate(owner) && (isSensitive(owner) || isSensitive(assigned))) {
    fail("capability aggregate mutation", target);
  }
}

function inspectObjectTargets(
  pattern: ts.ObjectLiteralExpression,
  assigned: AbstractValue,
  evaluate: Evaluate,
  fail: Fail,
): void {
  for (const property of pattern.properties) {
    const child = assignmentTarget(property);
    if (child) inspectMutationTarget(child, assigned, evaluate, fail);
  }
}

function inspectArrayTargets(
  pattern: ts.ArrayLiteralExpression,
  assigned: AbstractValue,
  evaluate: Evaluate,
  fail: Fail,
): void {
  for (const element of pattern.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const child = ts.isSpreadElement(element) ? element.expression : element;
    inspectMutationTarget(child, assigned, evaluate, fail);
  }
}

function isSpecialOwner(value: AbstractValue): boolean {
  return (
    hasHostFlow(value) ||
    value.flow !== 0 ||
    value.wrapper !== undefined ||
    value.mutator !== undefined ||
    value.descriptor !== undefined
  );
}

function isAllowedOpaqueHostWrite(
  owner: AbstractValue,
  target: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  evaluate: Evaluate,
): boolean {
  if (!ts.isElementAccessExpression(target)) return false;
  const key = evaluate(target.argumentExpression);
  const paths = owner.hostPaths ?? [];
  return (
    key.opaqueKey === true &&
    key.keys?.length === 1 &&
    key.keys[0] === "__ͼ" &&
    paths.length > 0 &&
    paths.every(isCounterHostPath)
  );
}

function isCounterHostPath(path: string): boolean {
  return path === "globalThis" || path === "window";
}

function isAggregate(value: AbstractValue): boolean {
  return value.properties !== undefined || value.elements !== undefined;
}

function isSensitive(value: AbstractValue): boolean {
  if (
    hasCapabilityFlow(value) ||
    hasCallableCapability(value) ||
    value.callableSafe ||
    value.wrapper ||
    value.mutator
  ) {
    return true;
  }
  if (value.elements?.some(isSensitive)) return true;
  return value.properties ? [...value.properties.values()].some(isSensitive) : false;
}

function assignmentTarget(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isSpreadAssignment(property)) return property.expression;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

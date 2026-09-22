import ts from "typescript";
import {
  type AbstractValue,
  Flow,
  flowing,
  hasCallableCapability,
  hasCapabilityFlow,
  hasFlow,
  mergeAll,
  mergeValues,
  objectValue,
  SAFE,
  staticString,
  unwrapExpression,
} from "./security-flow.js";
import type { InvocationShape } from "./security-invocation.js";
import {
  FORBIDDEN_PROPERTIES,
  HOST_CHILDREN,
  isFunctionExpression,
  SAFE_EMITTED_HOST_CALLS,
  SAFE_EMITTED_HOST_CONSTRUCTORS,
  SAFE_EMITTED_HOST_VALUES,
} from "./security-policy.js";

type Fail = (reason: string, node: ts.Node) => void;
type Evaluate = (expression: ts.Expression) => AbstractValue;
type CloseFunction = (node: ts.FunctionLikeDeclaration) => AbstractValue;

export function objectLiteralValue(
  node: ts.ObjectLiteralExpression,
  evaluate: Evaluate,
  closeFunction: CloseFunction,
): AbstractValue {
  const properties = new Map<string, AbstractValue>();
  for (const property of node.properties) {
    const entry = objectEntry(property, evaluate, closeFunction);
    if (!entry) return unsafeObjectLiteralValue(node, evaluate, closeFunction);
    properties.set(entry[0], entry[1]);
  }
  return objectValue(properties);
}

export function classMethodValue(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  closeFunction: CloseFunction,
): AbstractValue | undefined {
  if (unwrapExpression(node.expression).kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  const name = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : staticString(node.argumentExpression);
  if (!name) return undefined;
  let parent: ts.Node | undefined = node.parent;
  while (parent && !ts.isClassLike(parent)) parent = parent.parent;
  if (!parent) return undefined;
  const method = parent.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && objectPropertyName(member.name) === name,
  );
  return method ? closeFunction(method) : undefined;
}

export function ownPropertyValue(
  owner: AbstractValue,
  names: readonly string[],
  dynamic: boolean,
): AbstractValue | undefined {
  if (!owner.properties) return undefined;
  if (dynamic) {
    const { callableSafe: _callableSafe, ...value } = mergeAll([...owner.properties.values()]);
    return { ...value, constructorSpecial: true };
  }
  const values = names.map((name) => owner.properties?.get(name)).filter(isValue);
  if (values.length !== names.length) return undefined;
  const value = mergeAll(values);
  return names.includes("constructor") ? mergeValues(value, flowing(Flow.InertData)) : value;
}

export function regexMemberValue(
  owner: AbstractValue,
  names: readonly string[],
): AbstractValue | undefined {
  return owner.regex && names.length === 1 && names[0] === "test"
    ? { flow: 0, callableSafe: true }
    : undefined;
}

export function isSpecialConstructorOwner(owner: AbstractValue): boolean {
  return (
    owner.functions !== undefined ||
    owner.callableSafe === true ||
    owner.constructorSpecial === true ||
    owner.flow !== 0 ||
    owner.hostPaths !== undefined ||
    owner.wrapper !== undefined ||
    owner.mutator !== undefined
  );
}

export function hostMemberValue(
  owner: AbstractValue,
  names: readonly string[],
  dynamic: boolean,
  node: ts.Node,
  fail: Fail,
): AbstractValue {
  const paths = memberPaths(owner, names);
  if (dynamic) {
    fail("dynamic global-host property", node);
    return { flow: Flow.UnknownHost, hostPaths: paths };
  }
  if (names.some((name) => FORBIDDEN_PROPERTIES.has(name))) {
    fail(`forbidden global-host property ${names.join("|")}`, node);
    return { flow: Flow.Forbidden, hostPaths: paths };
  }
  if (
    names.length &&
    names.every((name) => HOST_CHILDREN.has(name)) &&
    owner.hostPaths?.every((path) => GLOBAL_CONTAINER_PATHS.has(path))
  ) {
    return { flow: Flow.Host, hostPaths: names };
  }
  if (paths.length && paths.every((path) => SAFE_EMITTED_HOST_CALLS.has(path))) {
    return { flow: Flow.SafeHostDerived | Flow.SafeHostCall, hostPaths: paths };
  }
  if (paths.length && paths.every((path) => SAFE_EMITTED_HOST_CONSTRUCTORS.has(path))) {
    return { flow: Flow.SafeHostDerived | Flow.SafeHostNew, hostPaths: paths };
  }
  if (paths.length && paths.every((path) => SAFE_EMITTED_HOST_VALUES.has(path))) {
    return { flow: Flow.SafeHostDerived, hostPaths: paths };
  }
  return { flow: Flow.HostDerived, hostPaths: paths };
}

export function reflectMemberValue(
  names: readonly string[],
  dynamic: boolean,
  node: ts.Node,
  fail: Fail,
): AbstractValue {
  if (dynamic) return unsupported("dynamic Reflect property", node, fail);
  if (names.includes("get")) return flowing(Flow.ReflectGet);
  if (names.includes("construct")) return flowing(Flow.ReflectConstruct);
  if (names.includes("apply")) return { flow: 0, wrapper: { mode: "reflectApply", target: SAFE } };
  if (names.includes("set")) return { flow: 0, mutator: "reflectSet" };
  if (names.includes("defineProperty")) return { flow: 0, mutator: "reflectDefineProperty" };
  return { flow: 0, constructorSpecial: true };
}

export function objectMemberValue(
  names: readonly string[],
  dynamic: boolean,
  node: ts.Node,
  fail: Fail,
): AbstractValue {
  if (dynamic) return unsupported("dynamic Object reflection property", node, fail);
  if (names.includes("constructor")) return unsupported("Object.constructor", node, fail);
  if (names.includes("assign")) return { flow: 0, mutator: "assign", constructorSpecial: true };
  if (names.includes("defineProperty")) {
    return { flow: 0, mutator: "defineProperty", constructorSpecial: true };
  }
  const descriptors = ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors"];
  return names.some((name) => descriptors.includes(name))
    ? flowing(Flow.DescriptorGet)
    : { flow: 0, constructorSpecial: true };
}

export function inspectInvocation(callee: AbstractValue, shape: InvocationShape, fail: Fail): void {
  const { node } = shape;
  if (!shape.argumentsExact && isSensitiveCallee(callee)) {
    fail("unprovable security-sensitive argument spread", node);
  }
  if (shape.receiver && !isCompatibleReceiver(callee, shape.receiver)) {
    fail("incompatible extracted call receiver", node);
  }
  if (hasFlow(callee, Flow.Forbidden)) fail("forbidden dynamic invocation", node);
  if (hasFlow(callee, Flow.InertData)) fail("inert data invocation", node);
  if (hasFlow(callee, Flow.ConstructorPotential)) fail("constructor capability invocation", node);
  if (
    hasFlow(callee, Flow.UnknownHost) ||
    hasFlow(callee, Flow.Host) ||
    hasFlow(callee, Flow.HostDerived)
  ) {
    fail(`unprovable global-host invocation ${callee.hostPaths?.join("|") ?? "unknown"}`, node);
  }
  if (hasFlow(callee, Flow.SafeHostDerived) && !isApprovedHostInvocation(callee, shape)) {
    fail("unapproved global-host invocation", node);
  }
  if (hasFlow(callee, Flow.ReflectConstruct)) fail("Reflect.construct", node);
}

export function isApprovedHostInvocation(callee: AbstractValue, shape: InvocationShape): boolean {
  const paths = callee.hostPaths ?? [];
  if (!paths.length || !shape.argumentsExact || shape.mode === "tag") return false;
  return paths.every((path) => approvedHostShape(path, shape));
}

export function hostInvocationResult(callee: AbstractValue): AbstractValue {
  return {
    flow: Flow.SafeHostDerived,
    hostPaths: (callee.hostPaths ?? []).map((path) => `${path}()`),
  };
}

export function timerCallValue(
  shape: InvocationShape,
  callee: AbstractValue,
  fail: Fail,
): AbstractValue {
  const { node } = shape;
  if (hasFlow(callee, Flow.BoundTimer)) return SAFE;
  if (shape.mode !== "call" || !shape.argumentsExact) {
    fail("dynamic timer code", node);
    return flowing(Flow.Forbidden);
  }
  const callback = shape.args[0];
  if (!isCallableSafe(callback)) {
    fail("dynamic timer code", node);
    return flowing(Flow.Forbidden);
  }
  return SAFE;
}

function isSensitiveCallee(callee: AbstractValue): boolean {
  return (
    callee.flow !== 0 ||
    callee.hostPaths !== undefined ||
    callee.descriptor !== undefined ||
    callee.mutator !== undefined
  );
}

function isCompatibleReceiver(callee: AbstractValue, receiver: AbstractValue): boolean {
  if (callee.functions?.length) return !hasCapabilityFlow(receiver) && !hasHostFlow(receiver);
  if (hasFlow(callee, Flow.ReflectGet) || hasFlow(callee, Flow.ReflectConstruct)) {
    return hasFlow(receiver, Flow.Reflect);
  }
  if (hasFlow(callee, Flow.DescriptorGet) || isObjectMutator(callee)) {
    return hasFlow(receiver, Flow.Object);
  }
  if (callee.mutator) return hasFlow(receiver, Flow.Reflect);
  if (hasFlow(callee, Flow.Timer)) return isGlobalContainer(receiver);
  if (!callee.hostPaths?.length) return true;
  return callee.hostPaths.every((path) => {
    const ownerPath = path.slice(0, path.lastIndexOf("."));
    return receiver.hostPaths?.includes(ownerPath) === true;
  });
}

function isGlobalContainer(value: AbstractValue): boolean {
  return value.hostPaths?.every((path) => GLOBAL_CONTAINER_PATHS.has(path)) === true;
}

function isObjectMutator(value: AbstractValue): boolean {
  return value.mutator === "assign" || value.mutator === "defineProperty";
}

function unsupported(reason: string, node: ts.Node, fail: Fail): AbstractValue {
  fail(reason, node);
  return flowing(Flow.UnknownHost);
}

function memberPaths(owner: AbstractValue, names: readonly string[]): string[] {
  return [
    ...new Set((owner.hostPaths ?? []).flatMap((path) => names.map((name) => `${path}.${name}`))),
  ];
}

function objectEntry(
  property: ts.ObjectLiteralElementLike,
  evaluate: Evaluate,
  closeFunction: CloseFunction,
): readonly [string, AbstractValue] | undefined {
  const name = objectPropertyName(property.name);
  if (!name) return undefined;
  if (ts.isPropertyAssignment(property)) return [name, evaluate(property.initializer)];
  if (ts.isShorthandPropertyAssignment(property)) return [name, evaluate(property.name)];
  if (ts.isMethodDeclaration(property)) return [name, closeFunction(property)];
  return [name, flowing(Flow.UnknownHost)];
}

function unsafeObjectLiteralValue(
  node: ts.ObjectLiteralExpression,
  evaluate: Evaluate,
  closeFunction: CloseFunction,
): AbstractValue {
  const values = node.properties.map((property) => {
    if (ts.isSpreadAssignment(property)) return evaluate(property.expression);
    if (ts.isPropertyAssignment(property)) return evaluate(property.initializer);
    if (ts.isShorthandPropertyAssignment(property)) return evaluate(property.name);
    if (ts.isMethodDeclaration(property)) return closeFunction(property);
    return flowing(Flow.UnknownHost);
  });
  return values.some((value) => hasCapabilityFlow(value) || hasCallableCapability(value))
    ? flowing(Flow.UnknownHost)
    : SAFE;
}

function objectPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  return ts.isComputedPropertyName(name) ? staticString(name.expression) : name.text;
}

function isValue(value: AbstractValue | undefined): value is AbstractValue {
  return value !== undefined;
}

function isCallableSafe(value: AbstractValue | undefined): boolean {
  return (
    value?.callableSafe === true &&
    value.flow === 0 &&
    !value.keys?.length &&
    !value.elements &&
    !value.properties &&
    !value.descriptor
  );
}

function approvedHostShape(path: string, shape: InvocationShape): boolean {
  const policy = HOST_CALL_POLICIES.get(path);
  const count = shape.args.length;
  if (!policy || policy.mode !== shape.mode || count < policy.min || count > policy.max)
    return false;
  if (policy.callback === undefined) return true;
  return (
    isCallableSafe(shape.args[policy.callback]) ||
    isProvenHandlerCallback(shape.node, shape.argumentNodes[policy.callback])
  );
}

function isProvenHandlerCallback(node: ts.Node, callback: ts.Expression | undefined): boolean {
  if (!callback || !ts.isElementAccessExpression(unwrapExpression(callback))) return false;
  const element = unwrapExpression(callback) as ts.ElementAccessExpression;
  if (!isThisHandlers(element.expression)) return false;
  let parent: ts.Node | undefined = node.parent;
  while (parent && !ts.isConstructorDeclaration(parent)) parent = parent.parent;
  if (!parent?.body) return false;
  let assignments = 0;
  let invalid = false;
  const visit = (child: ts.Node): void => {
    if (child !== parent && ts.isFunctionLike(child)) return;
    if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapExpression(child.left);
      if (isHandlerEntry(left)) {
        assignments += 1;
        if (!isFunctionExpression(unwrapExpression(child.right))) invalid = true;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(parent.body);
  return assignments > 0 && !invalid;
}

function isThisHandlers(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return (
    ts.isPropertyAccessExpression(value) &&
    value.expression.kind === ts.SyntaxKind.ThisKeyword &&
    value.name.text === "handlers"
  );
}

function isHandlerEntry(node: ts.Expression): boolean {
  return (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    isThisHandlers(node.expression)
  );
}

interface HostCallPolicy {
  readonly mode: "call" | "new";
  readonly min: number;
  readonly max: number;
  readonly callback?: number;
}

const HOST_CALL_POLICIES = new Map<string, HostCallPolicy>([
  ["globalThis.__ͼ.toString", { mode: "call", min: 0, max: 1 }],
  ["navigator.scheduling.isInputPending", { mode: "call", min: 0, max: 1 }],
  ["window.__ͼ.toString", { mode: "call", min: 0, max: 1 }],
  ["window.dispatchEvent", { mode: "call", min: 1, max: 1 }],
  ["window.EditContext().addEventListener", { mode: "call", min: 2, max: 3, callback: 1 }],
  ["window.EditContext().text.slice", { mode: "call", min: 1, max: 2 }],
  ["window.getComputedStyle", { mode: "call", min: 1, max: 2 }],
  ["window.matchMedia", { mode: "call", min: 1, max: 1 }],
  ["window.onerror", { mode: "call", min: 5, max: 5 }],
  ["window.scrollBy", { mode: "call", min: 2, max: 2 }],
  ["window.visualViewport.addEventListener", { mode: "call", min: 2, max: 3, callback: 1 }],
  ["window.EditContext", { mode: "new", min: 0, max: 1 }],
  ["window.EditContext().updateCharacterBounds", { mode: "call", min: 2, max: 2 }],
]);

const GLOBAL_CONTAINER_PATHS = new Set(["global", "globalThis", "self", "window"]);

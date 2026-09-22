import ts from "typescript";
import {
  type AbstractValue,
  Flow,
  flowing,
  hasFlow,
  memberName,
  SAFE,
  unwrapExpression,
} from "./security-flow.js";
import {
  FORBIDDEN_PROPERTIES,
  HOST_CHILDREN,
  type InvocationNode,
  isCallWrapper,
  isFunctionExpression,
  isMemberExpression,
  SAFE_EMITTED_HOST_CALLS,
  SAFE_EMITTED_HOST_CONSTRUCTORS,
  SAFE_EMITTED_HOST_VALUES,
} from "./security-policy.js";

type Fail = (reason: string, node: ts.Node) => void;

export function hostMemberValue(
  names: readonly string[],
  dynamic: boolean,
  node: ts.Node,
  fail: Fail,
): AbstractValue {
  if (dynamic) {
    fail("dynamic global-host property", node);
    return flowing(Flow.UnknownHost);
  }
  if (names.some((name) => FORBIDDEN_PROPERTIES.has(name))) {
    fail(`forbidden global-host property ${names.join("|")}`, node);
    return flowing(Flow.Forbidden);
  }
  if (names.length && names.every((name) => HOST_CHILDREN.has(name))) return flowing(Flow.Host);
  if (names.length && names.every((name) => SAFE_EMITTED_HOST_CALLS.has(name))) {
    return flowing(Flow.SafeHostDerived | Flow.SafeHostCall);
  }
  if (names.length && names.every((name) => SAFE_EMITTED_HOST_CONSTRUCTORS.has(name))) {
    return flowing(Flow.SafeHostDerived | Flow.SafeHostNew);
  }
  if (names.length && names.every((name) => SAFE_EMITTED_HOST_VALUES.has(name))) {
    return flowing(Flow.SafeHostDerived);
  }
  return flowing(Flow.HostDerived);
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
  return SAFE;
}

export function objectMemberValue(
  names: readonly string[],
  dynamic: boolean,
  node: ts.Node,
  fail: Fail,
): AbstractValue {
  if (dynamic) return unsupported("dynamic Object reflection property", node, fail);
  const descriptors = ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors"];
  return names.some((name) => descriptors.includes(name)) ? flowing(Flow.DescriptorGet) : SAFE;
}

export function inspectInvocation(callee: AbstractValue, node: InvocationNode, fail: Fail): void {
  if (hasFlow(callee, Flow.Forbidden)) fail("forbidden dynamic invocation", node);
  if (
    hasFlow(callee, Flow.UnknownHost) ||
    hasFlow(callee, Flow.Host) ||
    hasFlow(callee, Flow.HostDerived)
  ) {
    fail("unprovable global-host invocation", node);
  }
  if (hasFlow(callee, Flow.SafeHostDerived) && !isApprovedHostInvocation(callee, node)) {
    fail("unapproved global-host invocation", node);
  }
  if (hasFlow(callee, Flow.ReflectConstruct)) fail("Reflect.construct", node);
  if (isWrappedReflection(callee, node)) fail("reflection utility call/apply/bind wrapper", node);
}

export function isApprovedHostInvocation(callee: AbstractValue, node: InvocationNode): boolean {
  if (ts.isCallExpression(node)) return hasFlow(callee, Flow.SafeHostCall);
  if (ts.isNewExpression(node)) return hasFlow(callee, Flow.SafeHostNew);
  return false;
}

export function timerCallValue(
  node: InvocationNode,
  callee: AbstractValue,
  args: readonly AbstractValue[],
  fail: Fail,
): AbstractValue {
  if (ts.isTaggedTemplateExpression(node)) {
    fail("dynamic timer code", node);
    return flowing(Flow.Forbidden);
  }
  const wrapper = ts.isCallExpression(node) ? memberName(node.expression) : undefined;
  const callback = wrapper === "apply" ? args[1]?.elements?.[0] : args[wrapper ? 1 : 0];
  const callbackNode = timerCallbackNode(node, wrapper);
  if (wrapper === "bind" && !callback) return callee;
  if (!isTimerCallback(callbackNode, callback)) fail("dynamic timer code", node);
  return wrapper === "bind" ? callee : SAFE;
}

function isWrappedReflection(callee: AbstractValue, node: InvocationNode): boolean {
  return (
    ts.isCallExpression(node) &&
    isCallWrapper(node.expression) &&
    (hasFlow(callee, Flow.ReflectGet) || hasFlow(callee, Flow.DescriptorGet))
  );
}

function unsupported(reason: string, node: ts.Node, fail: Fail): AbstractValue {
  fail(reason, node);
  return flowing(Flow.UnknownHost);
}

function timerCallbackNode(
  node: ts.CallExpression | ts.NewExpression,
  wrapper: string | undefined,
): ts.Expression | undefined {
  if (wrapper === "apply") {
    const list = node.arguments?.[1];
    return list && ts.isArrayLiteralExpression(list) && !ts.isSpreadElement(list.elements[0])
      ? list.elements[0]
      : undefined;
  }
  return node.arguments?.[wrapper ? 1 : 0];
}

function isTimerCallback(
  node: ts.Expression | undefined,
  value: AbstractValue | undefined,
): boolean {
  if (value?.functions?.length) return true;
  if (!node) return false;
  const expression = unwrapExpression(node);
  if (isFunctionExpression(expression) || isMemberExpression(expression)) return true;
  return ts.isCallExpression(expression) && memberName(expression.expression) === "bind";
}

import ts from "typescript";
import {
  type AbstractValue,
  type CallWrapper,
  Flow,
  flowing,
  hasCapabilityFlow,
} from "./security-flow.js";
import type { InvocationNode } from "./security-policy.js";

type Evaluate = (expression: ts.Expression) => AbstractValue;
type Fail = (reason: string, node: ts.Node) => void;

export interface InvocationShape {
  readonly args: readonly AbstractValue[];
  readonly argumentNodes: readonly (ts.Expression | undefined)[];
  readonly argumentsExact: boolean;
  readonly mode: "call" | "new" | "tag";
  readonly node: InvocationNode;
  readonly receiver?: AbstractValue;
}

export interface ResolvedInvocation extends InvocationShape {
  readonly callee: AbstractValue;
}

export type InvocationResolution =
  | { readonly invocation: ResolvedInvocation }
  | { readonly result: AbstractValue };

export function wrapperValue(
  target: AbstractValue,
  mode: "apply" | "bind" | "call",
): AbstractValue {
  return { flow: 0, wrapper: { mode, target } };
}

export function isWrappable(value: AbstractValue): boolean {
  const callableFlows =
    Flow.Forbidden |
    Flow.ReflectGet |
    Flow.DescriptorGet |
    Flow.ReflectConstruct |
    Flow.Timer |
    Flow.ConstructorPotential |
    Flow.HostDerived |
    Flow.SafeHostCall |
    Flow.SafeHostNew;
  return (
    (value.flow & callableFlows) !== 0 ||
    value.functions !== undefined ||
    value.callableSafe === true ||
    value.wrapper !== undefined ||
    value.mutator !== undefined
  );
}

export function evaluateArguments(
  node: InvocationNode,
  evaluate: Evaluate,
): Pick<InvocationShape, "args" | "argumentNodes" | "argumentsExact"> {
  if (ts.isTaggedTemplateExpression(node)) {
    return { args: [], argumentNodes: [], argumentsExact: true };
  }
  const args: AbstractValue[] = [];
  const argumentNodes: (ts.Expression | undefined)[] = [];
  let argumentsExact = true;
  for (const argument of node.arguments ?? []) {
    if (!ts.isSpreadElement(argument)) {
      args.push(evaluate(argument));
      argumentNodes.push(argument);
      continue;
    }
    const spread = evaluate(argument.expression);
    if (!spread.tupleExact || !spread.elements) {
      argumentsExact = false;
      args.push(flowing(Flow.UnknownHost));
      argumentNodes.push(undefined);
      continue;
    }
    args.push(...spread.elements);
    argumentNodes.push(...spread.elements.map(() => argument.expression));
  }
  return { args, argumentNodes, argumentsExact };
}

export function resolveInvocation(
  callee: AbstractValue,
  node: InvocationNode,
  args: readonly AbstractValue[],
  argumentNodes: readonly (ts.Expression | undefined)[],
  argumentsExact: boolean,
  fail: Fail,
): InvocationResolution {
  const shape: InvocationShape = {
    args,
    argumentNodes,
    argumentsExact,
    mode: invocationMode(node),
    node,
  };
  return resolveWrapper(callee, shape, fail, 0);
}

function resolveWrapper(
  callee: AbstractValue,
  shape: InvocationShape,
  fail: Fail,
  depth: number,
): InvocationResolution {
  if (!callee.wrapper) return { invocation: { ...shape, callee } };
  if (depth >= 12) {
    fail("call wrapper depth cap exhausted", shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  const wrapper = callee.wrapper;
  if (!shape.argumentsExact) {
    fail("unprovable call wrapper argument spread", shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  if (wrapper.mode === "bound") return resolveBound(wrapper, shape, fail, depth);
  if (shape.mode !== "call") {
    fail("call wrapper used outside call mode", shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  if (wrapper.mode === "bind") return bindResult(wrapper.target, shape, fail);
  if (wrapper.mode === "reflectApply") return resolveReflectApply(shape, fail, depth);
  return resolveShifted(wrapper, shape, fail, depth);
}

function resolveReflectApply(
  shape: InvocationShape,
  fail: Fail,
  depth: number,
): InvocationResolution {
  const [target, receiver, args] = shape.args;
  if (shape.args.length !== 3 || !target || !receiver || !args?.tupleExact || !args.elements) {
    fail("unprovable Reflect.apply arguments", shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  return resolveWrapper(
    target,
    {
      ...shape,
      args: args.elements,
      argumentNodes: args.elements.map(() => undefined),
      receiver,
    },
    fail,
    depth + 1,
  );
}

function resolveBound(
  wrapper: CallWrapper,
  shape: InvocationShape,
  fail: Fail,
  depth: number,
): InvocationResolution {
  const next = {
    ...shape,
    args: [...(wrapper.args ?? []), ...shape.args],
    argumentNodes: [...(wrapper.args ?? []).map(() => undefined), ...shape.argumentNodes],
    receiver: wrapper.receiver,
  };
  return resolveWrapper(wrapper.target, next, fail, depth + 1);
}

function resolveShifted(
  wrapper: CallWrapper,
  shape: InvocationShape,
  fail: Fail,
  depth: number,
): InvocationResolution {
  const receiver = shape.args[0];
  if (!receiver) {
    fail(`extracted ${wrapper.mode} missing receiver`, shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  if (wrapper.mode === "call") {
    return resolveWrapper(
      wrapper.target,
      {
        ...shape,
        args: shape.args.slice(1),
        argumentNodes: shape.argumentNodes.slice(1),
        receiver,
      },
      fail,
      depth + 1,
    );
  }
  const spread = shape.args[1];
  if (shape.args.length !== 2 || !spread?.tupleExact || !spread.elements) {
    fail("unprovable extracted apply arguments", shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  return resolveWrapper(
    wrapper.target,
    {
      ...shape,
      args: spread.elements,
      argumentNodes: spread.elements.map(() => undefined),
      receiver,
    },
    fail,
    depth + 1,
  );
}

function bindResult(
  target: AbstractValue,
  shape: InvocationShape,
  fail: Fail,
): InvocationResolution {
  const receiver = shape.args[0];
  if (!receiver) {
    fail("extracted bind missing receiver", shape.node);
    return { result: flowing(Flow.UnknownHost) };
  }
  const boundArgs = shape.args.slice(1);
  const callableSafe =
    target.callableSafe === true &&
    !hasCapabilityFlow(receiver) &&
    boundArgs.every((argument) => !hasCapabilityFlow(argument));
  return {
    result: {
      flow: 0,
      wrapper: { mode: "bound", target, receiver, args: boundArgs },
      ...(callableSafe ? { callableSafe: true } : {}),
    },
  };
}

function invocationMode(node: InvocationNode): InvocationShape["mode"] {
  if (ts.isTaggedTemplateExpression(node)) return "tag";
  return ts.isNewExpression(node) ? "new" : "call";
}

import type ts from "typescript";
import { isSpecialConstructorOwner } from "./security-capabilities.js";
import {
  type AbstractValue,
  descriptorValue,
  Flow,
  flowing,
  hasFlow,
  hasHostFlow,
  SAFE,
} from "./security-flow.js";
import type { InvocationShape } from "./security-invocation.js";

type Lookup = (owner: AbstractValue, key: AbstractValue, node: ts.Node) => AbstractValue;
type Fail = (reason: string, node: ts.Node) => void;

export function reflectionCallValue(
  callee: AbstractValue,
  shape: InvocationShape,
  lookup: Lookup,
  fail: Fail,
): AbstractValue | undefined {
  const descriptor = hasFlow(callee, Flow.DescriptorGet);
  if (!descriptor && !hasFlow(callee, Flow.ReflectGet)) return undefined;
  if (shape.mode !== "call" || !shape.argumentsExact) {
    fail("unsupported reflection invocation", shape.node);
    return flowing(Flow.UnknownHost);
  }
  const value = reflectGet(shape.args[0] ?? SAFE, shape.args[1] ?? SAFE, shape.node, lookup, fail);
  return descriptor ? descriptorValue(value) : value;
}

function reflectGet(
  owner: AbstractValue,
  key: AbstractValue,
  node: ts.Node,
  lookup: Lookup,
  fail: Fail,
): AbstractValue {
  if (key.keys?.includes("constructor")) return reflectConstructor(owner, node, fail);
  if (!hasHostFlow(owner)) return SAFE;
  return lookup(owner, key, node);
}

function reflectConstructor(owner: AbstractValue, node: ts.Node, fail: Fail): AbstractValue {
  if (!isSpecialConstructorOwner(owner)) return flowing(Flow.ConstructorPotential);
  fail("reflective constructor access", node);
  return flowing(Flow.Forbidden);
}

import type ts from "typescript";
import { isBoundedFunction, isInspectableFunction } from "./security-function-shape.js";
import { valueSignature } from "./security-signature.js";

export { valueSignature } from "./security-signature.js";

export {
  isInertLiteralArray,
  memberName,
  memberOwner,
  staticString,
  unwrapExpression,
} from "./security-syntax.js";

export enum Flow {
  Host = 1 << 0,
  HostDerived = 1 << 1,
  UnknownHost = 1 << 2,
  Forbidden = 1 << 3,
  Reflect = 1 << 4,
  Object = 1 << 5,
  ReflectGet = 1 << 6,
  DescriptorGet = 1 << 7,
  ReflectConstruct = 1 << 8,
  SafeHostDerived = 1 << 9,
  SafeHostCall = 1 << 10,
  Timer = 1 << 11,
  SafeHostNew = 1 << 12,
  BoundTimer = 1 << 13,
  InertData = 1 << 14,
  ConstructorPotential = 1 << 15,
}

export interface AbstractValue {
  readonly flow: number;
  readonly bottom?: boolean;
  readonly keys?: readonly string[];
  readonly opaqueKey?: boolean;
  readonly keyComplete?: boolean;
  readonly elements?: readonly AbstractValue[];
  readonly functions?: readonly FunctionClosure[];
  readonly descriptor?: AbstractValue;
  readonly callableSafe?: boolean;
  readonly hostPaths?: readonly string[];
  readonly properties?: ReadonlyMap<string, AbstractValue>;
  readonly constructorSpecial?: boolean;
  readonly tupleExact?: boolean;
  readonly wrapper?: CallWrapper;
  readonly mutator?: "assign" | "defineProperty" | "reflectDefineProperty" | "reflectSet";
  readonly regex?: boolean;
  readonly uninitialized?: boolean;
}

export interface CallWrapper {
  readonly mode: "apply" | "bind" | "bound" | "call" | "reflectApply";
  readonly target: AbstractValue;
  readonly receiver?: AbstractValue;
  readonly args?: readonly AbstractValue[];
}

export interface FunctionClosure {
  readonly node: ts.FunctionLikeDeclaration;
  readonly captures?: ReadonlyMap<string, AbstractValue>;
  readonly capabilitySource?: boolean;
  readonly bounded: boolean;
  readonly callableSafe: boolean;
}

export const SAFE: AbstractValue = Object.freeze({ flow: 0 });
export const BOTTOM: AbstractValue = Object.freeze({ flow: 0, bottom: true });

export function flowing(flow: Flow): AbstractValue {
  return { flow };
}

export function hostValue(path: string): AbstractValue {
  return { flow: Flow.Host, hostPaths: [path] };
}

export function keyValue(key: string): AbstractValue {
  return { flow: 0, keys: [key], keyComplete: true };
}

export function opaqueKey(): AbstractValue {
  return { flow: 0, opaqueKey: true, keyComplete: true };
}

export function arrayValue(elements: readonly AbstractValue[], tupleExact = true): AbstractValue {
  return { flow: 0, elements, ...(tupleExact ? { tupleExact: true } : {}) };
}

export function objectValue(properties: ReadonlyMap<string, AbstractValue>): AbstractValue {
  return { flow: 0, properties };
}

export function directFunctionValue(
  node: ts.FunctionLikeDeclaration,
  captures?: ReadonlyMap<string, AbstractValue>,
  capabilitySource = captureHasCapability(captures),
): AbstractValue {
  const bounded = isBoundedFunction(node);
  const callableSafe = !capabilitySource && isInspectableFunction(node);
  return {
    flow: 0,
    functions: [{ node, captures, capabilitySource, bounded, callableSafe }],
    ...(callableSafe ? { callableSafe: true } : {}),
  };
}

export function descriptorValue(value: AbstractValue): AbstractValue {
  return { flow: 0, descriptor: value };
}

export function hasFlow(value: AbstractValue, flow: Flow): boolean {
  return (value.flow & flow) !== 0;
}

export function hasHostFlow(value: AbstractValue): boolean {
  return (
    (value.flow &
      (Flow.Host |
        Flow.HostDerived |
        Flow.UnknownHost |
        Flow.SafeHostDerived |
        Flow.SafeHostCall |
        Flow.SafeHostNew)) !==
    0
  );
}

export function hasCapabilityFlow(value: AbstractValue): boolean {
  return (
    (value.flow & ~(Flow.SafeHostDerived | Flow.SafeHostCall | Flow.SafeHostNew)) !== 0 ||
    value.descriptor !== undefined ||
    value.wrapper !== undefined ||
    value.mutator !== undefined
  );
}

export function hasCallableCapability(value: AbstractValue): boolean {
  return value.functions?.some((closure) => closure.capabilitySource) === true;
}

export function capabilityCaptures(
  values: ReadonlyMap<string, AbstractValue>,
): ReadonlyMap<string, AbstractValue> | undefined {
  const captures = new Map(
    [...values].filter(([, value]) => hasCapabilityFlow(value) || hasCallableCapability(value)),
  );
  return captures.size ? captures : undefined;
}

export function mergeCaptureMaps(
  left: ReadonlyMap<string, AbstractValue> | undefined,
  right: ReadonlyMap<string, AbstractValue>,
): ReadonlyMap<string, AbstractValue> | undefined {
  const captures = new Map(left ?? []);
  for (const [name, value] of right) captures.set(name, value);
  return captures.size ? captures : undefined;
}

export function mergeValues(left: AbstractValue, right: AbstractValue): AbstractValue {
  if (left.bottom) return right;
  if (right.bottom) return left;
  if (left.uninitialized) return right;
  if (right.uninitialized) return left;
  const keys = mergeStrings(left.keys, right.keys);
  const functions = mergeFunctions(left.functions, right.functions);
  const hostPaths = mergeStrings(left.hostPaths, right.hostPaths);
  const elements = mergeElements(left.elements, right.elements);
  const descriptor = mergeDescriptor(left.descriptor, right.descriptor);
  const properties = mergeProperties(left.properties, right.properties);
  const wrapper = mergeWrapper(left, right);
  const mutator = mergeMutator(left, right);
  const flow = mergedFlow(left, right);
  const constructorSpecial = left.constructorSpecial || right.constructorSpecial;
  const callableSafe = mergedCallableSafe({
    constructorSpecial,
    descriptor,
    elements,
    flow,
    functions,
    keys,
    mutator,
    properties,
    sourceCallableSafe: left.callableSafe === true && right.callableSafe === true,
    wrapper,
  });
  const tupleExact =
    left.tupleExact === true &&
    right.tupleExact === true &&
    left.elements?.length === right.elements?.length;
  return buildMergedValue({
    callableSafe,
    constructorSpecial,
    descriptor,
    elements,
    flow,
    functions,
    hostPaths,
    keys,
    left,
    mutator,
    properties,
    right,
    tupleExact,
    wrapper,
  });
}

function buildMergedValue(
  parts: MergeParts & {
    readonly callableSafe: boolean;
    readonly hostPaths: readonly string[];
    readonly left: AbstractValue;
    readonly right: AbstractValue;
    readonly tupleExact: boolean;
  },
): AbstractValue {
  return {
    flow: parts.flow,
    ...(parts.keys.length ? { keys: parts.keys } : {}),
    ...(parts.left.opaqueKey || parts.right.opaqueKey ? { opaqueKey: true } : {}),
    ...(parts.left.keyComplete && parts.right.keyComplete ? { keyComplete: true } : {}),
    ...parts.elements,
    ...(parts.functions.length ? { functions: parts.functions } : {}),
    ...(parts.callableSafe ? { callableSafe: true } : {}),
    ...(parts.hostPaths.length ? { hostPaths: parts.hostPaths } : {}),
    ...(parts.constructorSpecial ? { constructorSpecial: true } : {}),
    ...(parts.tupleExact ? { tupleExact: true } : {}),
    ...(parts.wrapper ? { wrapper: parts.wrapper } : {}),
    ...(parts.mutator ? { mutator: parts.mutator } : {}),
    ...(parts.left.regex && parts.right.regex ? { regex: true } : {}),
    ...parts.properties,
    ...parts.descriptor,
  };
}

export function mergeAll(values: readonly AbstractValue[]): AbstractValue {
  return values.reduce(mergeValues, BOTTOM);
}

interface MergeParts {
  readonly constructorSpecial?: boolean;
  readonly descriptor: Pick<AbstractValue, "descriptor">;
  readonly elements: Pick<AbstractValue, "elements">;
  readonly flow: number;
  readonly functions: readonly FunctionClosure[];
  readonly keys: readonly string[];
  readonly mutator?: AbstractValue["mutator"];
  readonly properties: Pick<AbstractValue, "properties">;
  readonly sourceCallableSafe: boolean;
  readonly wrapper?: CallWrapper;
}

function mergedFlow(left: AbstractValue, right: AbstractValue): number {
  const wrapperFallbackSafe =
    (left.wrapper !== undefined && isPlainSafe(right)) ||
    (right.wrapper !== undefined && isPlainSafe(left));
  const incompatibleWrapper =
    Boolean(left.wrapper) !== Boolean(right.wrapper) &&
    !wrapperFallbackSafe &&
    !(left.callableSafe === true && right.callableSafe === true);
  const incompatibleMutator =
    Boolean(left.mutator) !== Boolean(right.mutator) &&
    !((left.mutator && isPlainSafe(right)) || (right.mutator && isPlainSafe(left)));
  return (
    left.flow | right.flow | (incompatibleWrapper || incompatibleMutator ? Flow.UnknownHost : 0)
  );
}

function mergedCallableSafe(parts: MergeParts): boolean {
  const knownCallable =
    (parts.functions.length > 0 && parts.functions.every((closure) => closure.callableSafe)) ||
    (parts.wrapper?.mode === "bound" &&
      (parts.sourceCallableSafe || parts.wrapper.target.callableSafe === true));
  return (
    knownCallable &&
    parts.flow === 0 &&
    parts.keys.length === 0 &&
    !parts.elements.elements &&
    !parts.descriptor.descriptor &&
    !parts.properties.properties &&
    !parts.constructorSpecial &&
    (!parts.wrapper || parts.wrapper.mode === "bound") &&
    !parts.mutator
  );
}

function mergeStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])].sort();
}

function mergeFunctions(
  left: readonly FunctionClosure[] | undefined,
  right: readonly FunctionClosure[] | undefined,
): FunctionClosure[] {
  return [
    ...new Map(
      [...(left ?? []), ...(right ?? [])].map((closure) => [
        `${closure.node.pos}:${closure.capabilitySource ? 1 : 0}:${closure.bounded ? 1 : 0}:${closure.callableSafe ? 1 : 0}:${captureSignature(closure.captures)}`,
        closure,
      ]),
    ).values(),
  ];
}

function mergeElements(
  left: readonly AbstractValue[] | undefined,
  right: readonly AbstractValue[] | undefined,
): Pick<AbstractValue, "elements"> {
  if (!left || !right) return {};
  const length = Math.max(left.length, right.length);
  return {
    elements: Array.from({ length }, (_, index) =>
      mergeValues(left[index] ?? SAFE, right[index] ?? SAFE),
    ),
  };
}

function mergeDescriptor(
  left: AbstractValue | undefined,
  right: AbstractValue | undefined,
): Pick<AbstractValue, "descriptor"> {
  if (!left) return right ? { descriptor: right } : {};
  if (!right) return { descriptor: left };
  return { descriptor: mergeValues(left, right) };
}

function mergeWrapper(
  leftValue: AbstractValue,
  rightValue: AbstractValue,
): CallWrapper | undefined {
  const left = leftValue.wrapper;
  const right = rightValue.wrapper;
  if (left && isPlainSafe(rightValue)) return left;
  if (right && isPlainSafe(leftValue)) return right;
  if (!left || !right || left.mode !== right.mode) return undefined;
  if ((left.args?.length ?? 0) !== (right.args?.length ?? 0)) return undefined;
  return {
    mode: left.mode,
    target: mergeValues(left.target, right.target),
    ...(left.receiver && right.receiver
      ? { receiver: mergeValues(left.receiver, right.receiver) }
      : {}),
    ...(left.args && right.args
      ? { args: left.args.map((value, index) => mergeValues(value, right.args?.[index] ?? SAFE)) }
      : {}),
  };
}

function mergeMutator(left: AbstractValue, right: AbstractValue): AbstractValue["mutator"] {
  if (left.mutator === right.mutator) return left.mutator;
  if (left.mutator && isPlainSafe(right)) return left.mutator;
  return right.mutator && isPlainSafe(left) ? right.mutator : undefined;
}

function isPlainSafe(value: AbstractValue): boolean {
  return valueSignature(value) === valueSignature(SAFE);
}

function mergeProperties(
  left: ReadonlyMap<string, AbstractValue> | undefined,
  right: ReadonlyMap<string, AbstractValue> | undefined,
): Pick<AbstractValue, "properties"> {
  if (!left || !right) return {};
  const properties = new Map(left);
  for (const [name, value] of right) {
    properties.set(name, mergeValues(properties.get(name) ?? BOTTOM, value));
  }
  return { properties };
}

function captureSignature(captures: ReadonlyMap<string, AbstractValue> | undefined): string {
  if (!captures) return "";
  return [...captures]
    .map(([name, value]) => `${name}=${value.flow}`)
    .sort()
    .join(",");
}

function captureHasCapability(captures: ReadonlyMap<string, AbstractValue> | undefined): boolean {
  return captures ? [...captures.values()].some(hasCapabilityFlow) : false;
}

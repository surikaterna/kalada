import type { AbstractValue, CallWrapper, FunctionClosure } from "./security-flow.js";

export function valueSignature(value: AbstractValue): string {
  const elements = value.elements?.map(valueSignature).join(";") ?? "";
  const functions = functionSignature(value.functions);
  const descriptor = value.descriptor ? valueSignature(value.descriptor) : "";
  const properties = propertySignature(value.properties);
  const wrapper = wrapperSignature(value.wrapper);
  return [
    value.flow,
    value.bottom ? 1 : 0,
    value.keys?.join(",") ?? "",
    value.opaqueKey ? 1 : 0,
    value.keyComplete ? 1 : 0,
    elements,
    functions,
    descriptor,
    value.callableSafe ? 1 : 0,
    value.hostPaths?.join(",") ?? "",
    properties,
    value.constructorSpecial ? 1 : 0,
    value.tupleExact ? 1 : 0,
    wrapper,
    value.mutator ?? "",
    value.regex ? 1 : 0,
    value.uninitialized ? 1 : 0,
  ].join("|");
}

function functionSignature(functions: readonly FunctionClosure[] | undefined): string {
  return (
    functions
      ?.map(
        ({ node, captures, capabilitySource, bounded, callableSafe }) =>
          `${node.pos}:${capabilitySource ? 1 : 0}:${bounded ? 1 : 0}:${callableSafe ? 1 : 0}:${captureSignature(captures)}`,
      )
      .join(",") ?? ""
  );
}

function propertySignature(properties: AbstractValue["properties"]): string {
  return properties
    ? [...properties].map(([name, child]) => `${name}:${valueSignature(child)}`).join(",")
    : "";
}

function wrapperSignature(wrapper: CallWrapper | undefined): string {
  if (!wrapper) return "";
  const receiver = wrapper.receiver ? valueSignature(wrapper.receiver) : "";
  const args = wrapper.args?.map(valueSignature).join(";") ?? "";
  return `${wrapper.mode}:${valueSignature(wrapper.target)}:${receiver}:${args}`;
}

function captureSignature(captures: ReadonlyMap<string, AbstractValue> | undefined): string {
  if (!captures) return "";
  return [...captures]
    .map(([name, value]) => `${name}=${value.flow}`)
    .sort()
    .join(",");
}

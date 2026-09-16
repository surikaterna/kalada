const apply = Reflect.apply;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const functionToString = Function.prototype.toString;
const promiseThen = Promise.prototype.then;
const promiseSource = apply(functionToString, Promise, []);
const thenSource = apply(functionToString, promiseThen, []);
const speciesGetter = getDescriptor(Promise, Symbol.species)?.get;
const speciesSource = speciesGetter ? apply(functionToString, speciesGetter, []) : "";

type PromiseShape = "safe" | "suspicious" | "none";

/** Detect trusted native Promises without reading user-controlled properties. */
export function rejectCallbackPromise(value: unknown): boolean {
  const shape = promiseShape(value);
  if (shape === "none") return false;
  if (shape === "safe") consumeRejection(value as object);
  return true;
}

function promiseShape(value: unknown): PromiseShape {
  if (typeof value !== "object" || value === null) return "none";
  let prototype: object | null;
  try {
    prototype = getPrototype(value);
  } catch {
    return "none";
  }
  for (let depth = 0; prototype && depth < 4; depth += 1) {
    const prototypeShape = inspectPromisePrototype(prototype);
    if (prototypeShape !== "none") return inspectInstance(value, depth, prototypeShape);
    try {
      prototype = getPrototype(prototype);
    } catch {
      return "none";
    }
  }
  return "none";
}

function inspectPromisePrototype(prototype: object): PromiseShape {
  try {
    const then = getDescriptor(prototype, "then");
    if (!isNativeFunction(then, thenSource)) return "none";
    const constructorDescriptor = getDescriptor(prototype, "constructor");
    if (
      !constructorDescriptor ||
      !("value" in constructorDescriptor) ||
      typeof constructorDescriptor.value !== "function"
    )
      return "suspicious";
    const ownPrototype = getDescriptor(constructorDescriptor.value, "prototype");
    if (!ownPrototype || !("value" in ownPrototype) || ownPrototype.value !== prototype)
      return "suspicious";
    const species = getDescriptor(constructorDescriptor.value, Symbol.species);
    if (!species?.get || species.set !== undefined) return "suspicious";
    const constructorNative =
      apply(functionToString, constructorDescriptor.value, []) === promiseSource;
    const speciesNative = apply(functionToString, species.get, []) === speciesSource;
    return constructorNative && speciesNative ? "safe" : "suspicious";
  } catch {
    return "suspicious";
  }
}

function isNativeFunction(descriptor: PropertyDescriptor | undefined, source: string): boolean {
  return Boolean(
    descriptor &&
      "value" in descriptor &&
      typeof descriptor.value === "function" &&
      apply(functionToString, descriptor.value, []) === source,
  );
}

function inspectInstance(value: object, depth: number, prototypeShape: PromiseShape): PromiseShape {
  if (depth !== 0 || prototypeShape !== "safe") return "suspicious";
  try {
    const hasOverrides =
      getDescriptor(value, "constructor") !== undefined ||
      getDescriptor(value, "then") !== undefined ||
      getDescriptor(value, Symbol.species) !== undefined;
    return hasOverrides ? "suspicious" : "safe";
  } catch {
    return "suspicious";
  }
}

function consumeRejection(value: object): void {
  try {
    void apply(promiseThen, value, [undefined, () => undefined]);
  } catch {
    // A failed brand check remains an unsupported Promise-shaped callback result.
  }
}

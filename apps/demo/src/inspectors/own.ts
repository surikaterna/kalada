const REFLECTION_LIMIT = 8192;
const inspectionFailure = Object.freeze({ type: "inspector-reflection-failed" });

function reflected<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw inspectionFailure;
  }
}

export function inspectSafely<T>(operation: () => T, fallback: () => T): T {
  try {
    return operation();
  } catch {
    return fallback();
  }
}

export function ownData(value: unknown, key: PropertyKey): unknown {
  return ownDataProperty(value, key).value;
}

export function ownDataProperty(
  value: unknown,
  key: PropertyKey,
): Readonly<{ found: boolean; value?: unknown }> {
  if (!value || typeof value !== "object") return { found: false };
  const descriptor = reflected(() => Object.getOwnPropertyDescriptor(value, key));
  return descriptor && "value" in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false };
}

export function ownArray(value: unknown): readonly unknown[] {
  if (!isArray(value)) return [];
  const length = ownData(value, "length");
  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > REFLECTION_LIMIT
  )
    throw inspectionFailure;
  const output: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = reflected(() => Object.getOwnPropertyDescriptor(value as object, index));
    output.push(descriptor && "value" in descriptor ? descriptor.value : undefined);
  }
  return output;
}

export function isArray(value: unknown): value is readonly unknown[] {
  return reflected(() => Array.isArray(value));
}

export function ownEnumerableKeys(value: unknown): readonly string[] {
  if (!value || typeof value !== "object") return [];
  const keys = reflected(() => Reflect.ownKeys(value));
  if (keys.length > REFLECTION_LIMIT) throw inspectionFailure;
  return keys.filter((key): key is string => {
    if (typeof key !== "string") return false;
    const descriptor = reflected(() => Object.getOwnPropertyDescriptor(value, key));
    return descriptor?.enumerable === true;
  });
}

export function prototypeOf(value: object): object | null {
  return reflected(() => Object.getPrototypeOf(value));
}

export function guardedCall<T>(operation: () => T): T {
  return reflected(operation);
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || reflected(() => Object.isFrozen(value))) return value;
  const keys = reflected(() => Reflect.ownKeys(value));
  if (keys.length > REFLECTION_LIMIT) throw inspectionFailure;
  for (const key of keys) freeze(ownData(value, key));
  return reflected(() => Object.freeze(value));
}

export function omitted(): Readonly<{ kind: "omitted" }> {
  return Object.freeze({ kind: "omitted" });
}

export function unsupported(): Readonly<{ type: "unsupported" }> {
  return Object.freeze({ type: "unsupported" });
}

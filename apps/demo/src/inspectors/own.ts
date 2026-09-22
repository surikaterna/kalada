export function ownData(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function ownArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    output.push(descriptor && "value" in descriptor ? descriptor.value : undefined);
  }
  return output;
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
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) freeze(ownData(value, key));
  return Object.freeze(value);
}

export function omitted(): Readonly<{ kind: "omitted" }> {
  return Object.freeze({ kind: "omitted" });
}

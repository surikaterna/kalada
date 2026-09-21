export function readArray(input: unknown, maximum: number): readonly unknown[] | null {
  const result = readArrayPrefix(input, maximum);
  return result && !result.truncated ? result.items : null;
}

export function readArrayPrefix(
  input: unknown,
  maximum: number,
): Readonly<{ items: readonly unknown[]; truncated: boolean }> | null {
  if (!Array.isArray(input)) return null;
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      !Number.isSafeInteger(maximum) ||
      maximum < 0
    )
      return null;
    const output: unknown[] = [];
    const readLength = Math.min(length, maximum);
    for (let index = 0; index < readLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      output.push(descriptor.value);
    }
    return Object.freeze({ items: Object.freeze(output), truncated: length > maximum });
  } catch {
    return null;
  }
}

export function readStringArray(input: unknown, maximum: number): readonly string[] | null {
  const items = readArray(input, maximum);
  if (!items || items.some((item) => !validName(item))) return null;
  return Object.freeze(items as string[]);
}

export function validName(input: unknown): input is string {
  return typeof input === "string" && input.length > 0 && input.length <= 256;
}

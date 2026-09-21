export function readArray(input: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(input)) return null;
  try {
    if (input.length > maximum) return null;
    const output: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      output.push(descriptor.value);
    }
    return output;
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

export function frozenRecord(fields: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const output = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(output, key, { enumerable: true, value });
  }
  return Object.freeze(output);
}
